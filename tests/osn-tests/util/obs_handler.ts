import * as osn from '../osn';
import * as logger from '../util/logger';
import { Services } from '../util/services';
import { EOBSOutputType, EOBSOutputSignal} from '../util/obs_enums'
import { Subject } from 'rxjs';
import { first } from 'rxjs/operators';

// Interfaces
export interface IPerformanceState {
    CPU: number;
    numberDroppedFrames: number;
    percentageDroppedFrames: number;
    bandwidth: number;
    frameRate: number;
}

export interface IOBSOutputSignalInfo {
    type: EOBSOutputType;
    signal: EOBSOutputSignal;
    code: osn.EOutputCode;
    error: string;
}

export interface IConfigProgress {
    event: TConfigEvent;
    description: string;
    percentage?: number;
    continent?: string;
}

export interface IVec2 {
    x: number;
    y: number;
}

export interface ICrop {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

// Types
export type TOBSHotkey = {
    ObjectName: string;
    ObjectType: osn.EHotkeyObjectType;
    HotkeyName: string;
    HotkeyDesc: string;
    HotkeyId: number;
};

export type TConfigEvent = 'starting_step' | 'progress' | 'stopping_step' | 'error' | 'done';

// OBSHandler class
export class OBSHandler {
    private path = require('path');
    private uuid = require('uuid/v4');

    // Variables for obs initialization
    private workingDirectory: string = this.path.normalize(osn.wd);
    private language: string = 'en-US';
    private obsPath: string = this.path.join(this.path.normalize(__dirname), '..', 'osnData/slobs-client');
    private pipeName: string = 'osn-tests-pipe-'.concat(this.uuid());
    private version: string = '0.00.00-preview.0';

    // Other variables/objects
    private services: Services;
    private hasUserFromPool: boolean = false;
    private osnTestName: string;
    private signals = new Subject<IOBSOutputSignalInfo>();
    private progress = new Subject<IConfigProgress>();
    inputTypes: string[];
    filterTypes: string[];
    transitionTypes: string[];

    constructor(testName: string) {
        this.osnTestName = testName;
        this.services = new Services(testName);
        this.startup();
        this.inputTypes = osn.InputFactory.types();
        this.filterTypes = osn.FilterFactory.types();
        this.transitionTypes = osn.TransitionFactory.types();
    }

    startup() {
        logger.logInfo(this.osnTestName, 'Initializing OBS');

        try {
            osn.NodeObs.IPC.host(this.pipeName);
            osn.NodeObs.SetWorkingDirectory(this.workingDirectory);
            const initResult = osn.NodeObs.OBS_API_initAPI(this.language, this.obsPath, this.version);

            if (initResult != osn.EVideoCodes.Success) {
                throw Error('OBS process initialization failed with code ' + initResult);
            }  
        } catch(e) {
            throw Error('Exception when initializing OBS process' + e);
        }

        logger.logInfo(this.osnTestName, 'OBS started successfully')
    }

    shutdown() {
        logger.logInfo(this.osnTestName, 'Shutting down OBS');

        try {
            osn.NodeObs.OBS_service_removeCallback();
            osn.NodeObs.IPC.disconnect();
        } catch(e) {
            throw Error('Exception when shutting down OBS process' + e);
        }

        logger.logInfo(this.osnTestName, 'OBS shutdown successfully')
    }

    async reserveUser() {
        let streamKey: string = "";

        try {
            logger.logInfo(this.osnTestName, 'Getting stream key from user pool');
            streamKey = await this.services.getStreamKey();
            this.hasUserFromPool = true;
        } catch(e) {
            logger.logWarning(this.osnTestName, e);
            logger.logWarning(this.osnTestName, 'Using predefined stream key');
            streamKey = process.env.SLOBS_BE_STREAMKEY;
            this.hasUserFromPool = false;
        }

        this.setSetting('Stream', 'key', streamKey);
        logger.logInfo(this.osnTestName, 'Stream key saved successfully')
    }

    async releaseUser() {
        if (this.hasUserFromPool) {
            await this.services.releaseUser();
            this.hasUserFromPool = false;
        }
    }

    setSetting(category: string, parameter: string, value: any) {
        // Getting settings container
        const settings = osn.NodeObs.OBS_settings_getSettings(category).data;

        settings.forEach(subCategory => {
            subCategory.parameters.forEach(param => {
                if (param.name === parameter) {
                    param.currentValue = value;
                }
            });
        });

        // Saving updated settings container
        osn.NodeObs.OBS_settings_saveSettings(category, settings);
    }
	
    getSetting(category: string, parameter: string): any {
        let value: any;

        // Getting settings container
        const settings = osn.NodeObs.OBS_settings_getSettings(category).data;

        // Getting parameter value
        settings.forEach(subCategory => {
            subCategory.parameters.forEach(param => {
                if (param.name === parameter) {
                    value = param.currentValue;
                }
            });
        });

        return value;
    }

    setSettingsContainer(category: string, settings: any) {
        osn.NodeObs.OBS_settings_saveSettings(category, settings);
    }

    getSettingsContainer(category: string): any {
        return osn.NodeObs.OBS_settings_getSettings(category).data;
    }

    connectOutputSignals() {
        osn.NodeObs.OBS_service_connectOutputSignals((signalInfo: IOBSOutputSignalInfo) => {
            this.signals.next(signalInfo);
        });
    }

    getNextSignalInfo(): Promise<IOBSOutputSignalInfo> {
        return new Promise((resolve, reject) => {
            this.signals.pipe(first()).subscribe(signalInfo => resolve(signalInfo));
            setTimeout(() => reject('Output signal timeout'), 30000);
        });
    }

    startAutoconfig() {
        osn.NodeObs.InitializeAutoConfig((progressInfo: IConfigProgress) => {
            if (progressInfo.event == 'stopping_step' || progressInfo.event == 'done' || progressInfo.event == 'error') {
                this.progress.next(progressInfo);
            }
        },
        {
            service_name: 'Twitch',
        });
    }

    getNextProgressInfo(): Promise<IConfigProgress> {
        return new Promise((resolve, reject) => {
            this.progress.pipe(first()).subscribe(progressInfo => resolve(progressInfo));
            setTimeout(() => reject('Autoconfig step timeout'), 50000);
        });
    }
}