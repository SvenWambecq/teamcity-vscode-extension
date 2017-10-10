"use strict";

import {Logger} from "../utils/logger";
import {PatchSender} from "./patchsender";
import {CheckInInfo} from "./checkininfo";
import {WebLinks} from "../../dal/weblinks";
import {XmlParser} from "../utils/xmlparser";
import {QueuedBuild} from "../utils/queuedbuild";
import {VsCodeUtils} from "../utils/vscodeutils";
import {PatchManager} from "../utils/patchmanager";
import {CvsSupportProvider} from "../../dal/cvsprovider";
import {MessageManager} from "../../view/messagemanager";
import {ChangeListStatus, TYPES} from "../utils/constants";
import {BuildConfigItem} from "../entities/buildconfigitem";
import {CredentialsStore} from "../credentialsstore/credentialsstore";
import {inject, injectable} from "inversify";

@injectable()
export class CustomPatchSender implements PatchSender {
    private readonly CHECK_FREQUENCY_MS: number = 10000;
    private readonly webLinks: WebLinks;
    private readonly patchManager: PatchManager;
    private readonly xmlParser: XmlParser;
    private readonly credentialsStore: CredentialsStore;

    constructor(@inject(TYPES.WebLinks) webLinks: WebLinks,
                @inject(TYPES.PatchManager) patchManager: PatchManager,
                @inject(TYPES.XmlParser) xmlParser: XmlParser,
                @inject(TYPES.CredentialsStore) credentialsStore: CredentialsStore) {
        this.webLinks = webLinks;
        this.patchManager = patchManager;
        this.xmlParser = xmlParser;
        this.credentialsStore = credentialsStore;
    }

    /**
     * @returns true in case of success, otherwise false.
     */
    public async remoteRun(configs: BuildConfigItem[], cvsProvider: CvsSupportProvider): Promise<boolean> {
        await this.checkCredentialsExistence();
        const patchAbsPath: string = await this.patchManager.preparePatch(cvsProvider);
        const checkInInfo: CheckInInfo = await cvsProvider.getRequiredCheckInInfo();
        try {
            const changeListId = await this.webLinks.uploadChanges(patchAbsPath, checkInInfo.message);
            const queuedBuilds: QueuedBuild[] = await this.triggerChangeList(changeListId, configs);
            const changeListStatus: ChangeListStatus = await this.waitChangeStatusAppearance(queuedBuilds);
            if (changeListStatus === ChangeListStatus.CHECKED) {
                MessageManager.showInfoMessage(`Personal build for change #${changeListId} has "CHECKED" status.`);
                return true;
            } else {
                MessageManager.showWarningMessage(`Personal build for change #${changeListId} has "FAILED" status.`);
                return false;
            }
        } catch (err) {
            Logger.logError(VsCodeUtils.formatErrorMessage(err));
            return Promise.reject(VsCodeUtils.formatErrorMessage(err));
        }
    }

    private async checkCredentialsExistence(): Promise<void> {
        await this.credentialsStore.tryGetCredentials();
    }

    /**
     * @param changeListId - id of change list to trigger
     * @param buildConfigs - all build configs, which should be triggered
     */
    public async triggerChangeList(changeListId: string,
                                   buildConfigs: BuildConfigItem[]): Promise<QueuedBuild[]> {
        if (!buildConfigs) {
            return [];
        }
        const queuedBuilds: QueuedBuild[] = [];
        for (let i = 0; i < buildConfigs.length; i++) {
            const build: BuildConfigItem = buildConfigs[i];
            const queuedBuildInfoXml: string = await this.webLinks.buildQueue(changeListId, build);
            queuedBuilds.push(await this.xmlParser.parseQueuedBuild(queuedBuildInfoXml));
        }
        return queuedBuilds;
    }

    private async waitChangeStatusAppearance(queuedBuilds: QueuedBuild[]): Promise<ChangeListStatus> {
        if (!queuedBuilds) {
            return Promise.resolve<ChangeListStatus>(ChangeListStatus.CHECKED);
        }
        for (let i = 0; i < queuedBuilds.length; i++) {
            const buildStatus: string = await this.waitBuildStatusAppearance(queuedBuilds[i]);
            if (buildStatus !== "SUCCESS") {
                return ChangeListStatus.FAILED;
            }
        }
        return ChangeListStatus.CHECKED;
    }

    private async waitBuildStatusAppearance(build): Promise<string> {
        let buildStatus: string;
        while (!buildStatus) {
            buildStatus = await this.getBuildStatus(build);
            if (!buildStatus) {
                await VsCodeUtils.sleep(this.CHECK_FREQUENCY_MS);
            }
        }
        return buildStatus;
    }

    private async getBuildStatus(build: QueuedBuild): Promise<string> {
        const buildInfoXml: string = await this.webLinks.getBuildInfo(build.id);
        return this.xmlParser.parseBuildStatus(buildInfoXml);
    }
}
