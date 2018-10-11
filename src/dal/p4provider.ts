import * as url from "url";
import * as path from "path";
import { Logger } from "../bll/utils/logger";
import * as cp from "child-process-promise";
import { CvsSupportProvider } from "./cvsprovider";
import { Uri } from "vscode";
import { CvsResource } from "../bll/entities/cvsresources/cvsresource";
import { CheckInInfo } from "../bll/entities/checkininfo";
import { P4PathFinder } from "../bll/cvsutils/p4pathfinder";
import { Finder } from "../bll/cvsutils/finder";
import { Validator } from "../bll/cvsutils/validator";
import { P4IsActiveValidator } from "../bll/cvsutils/p4isactivevalidator";
import { DeletedCvsResource } from "../bll/entities/cvsresources/deletedcvsresource";
import { AddedCvsResource } from "../bll/entities/cvsresources/addedcvsresource";
import { ModifiedCvsResource } from "../bll/entities/cvsresources/modifiedcvsresource";
import { ReplacedCvsResource } from "../bll/entities/cvsresources/replacedcvsresource";
import { Utils } from "../bll/utils/utils";
import { Constants } from "../bll/utils/constants";
import { WorkspaceProxy } from "../bll/moduleproxies/workspace-proxy";

interface Dictionary<ValueType> {
    [Key: string]: ValueType;
}

export class P4Provider implements CvsSupportProvider {
    private workspaceRootPath: string;
    private workspaceRootPathAsUri: Uri;
    private p4Path: string;
    private p4Client: string;
    private p4Host: string;
    private _cache: Dictionary<string> = {}

    private constructor(rootPath: Uri) {
        this.workspaceRootPathAsUri = rootPath;
        this.workspaceRootPath = rootPath.fsPath;
    }

    public static async tryActivateInPath(workspaceRootPath: Uri): Promise<CvsSupportProvider> {
        let wsProxy = new WorkspaceProxy();
        const instance: P4Provider = new P4Provider(workspaceRootPath);
        const pathFinder: Finder = new P4PathFinder();
        const p4Path: string = await pathFinder.find();
        const isActiveValidator: Validator = new P4IsActiveValidator(p4Path, workspaceRootPath.fsPath);
        await isActiveValidator.validate();
        instance.p4Path = p4Path;
        instance.p4Client = wsProxy.getConfigurationValue(Constants.P4_WORKSPACE);
        instance.p4Host = wsProxy.getConfigurationValue(Constants.P4_HOST);
        return instance;
    }

    /**
     * There are two allowed tfs file path formats:
     * * File path format : http[s]://<server-path>:<server-port>/$foo/bar
     * * File path format : guid://guid/$foo/bar
     * We use first, because we can get user collection guid without his credential.
     * @return - A promise for array of formatted names of files, that are required for TeamCity remote run.
     */
    public async getFormattedFileNames(checkInInfo: CheckInInfo): Promise<string[]> {
        const formatFileNames: string[] = [];
        const cvsResources: CvsResource[] = checkInInfo.cvsLocalResources;
        cvsResources.forEach((localResource) => {
            formatFileNames.push(`${localResource.serverFilePath}`);
        });
        Logger.logDebug(`P4SupportProvider#getFormattedFilenames: formatFileNames: ${formatFileNames.join(" ")}`);
        return formatFileNames;
    }

    public async getRequiredCheckInInfo(): Promise<CheckInInfo> {
        Logger.logDebug(`P4SupportProvider#getRequiredCheckinInfo: should get checkIn info`);
        const cvsLocalResources: CvsResource[] = await this.getLocalResources();
        const serverItems: string[] = await this.getServerItems(cvsLocalResources);
        //await this.fillInServerPaths(cvsLocalResources);
        const cvsProvider: CvsSupportProvider = this;
        return new CheckInInfo(cvsLocalResources, cvsProvider, serverItems);
    }

    public async commit(checkInInfo: CheckInInfo) {
        throw new Error("Illegal to commit for P4");
    }

    public getStagedFileContentStream(cvsResource: CvsResource): undefined {
        return undefined;
    }

    private async getServerItems(cvsLocalResources: CvsResource[]): Promise<string[]> {
        const serverItems: string[] = [];
        cvsLocalResources.forEach((localResource) => {
            serverItems.push(localResource.serverFilePath);
        });
        return serverItems;
    }

    private async getLocalResources(): Promise<CvsResource[]> {
        //All possible status codes: add|branch|delete|edit|lock|merge|rename|source rename|undelete
        const parseBriefDiffRegExp: RegExp = /^(.*)#(\d+) - ([^ ]*) (.*)$/mg;
        const locationRegExp: RegExp = /^(.*) (.*) (.*)$/mg;
        const localResources: CvsResource[] = [];

        const briefDiffCommand: string = `"${this.p4Path}" -c ${this.p4Client} opened ${this.workspaceRootPath}/...`;

        let p4DiffResult: string;
        try {
            const briefDiffCommandOutput = await cp.exec(briefDiffCommand);
            p4DiffResult = briefDiffCommandOutput.stdout.toString("utf8").trim();
            Logger.logInfo(p4DiffResult);
        } catch (err) {
            Logger.logError(`P4SupportProvider#getAbsPaths: caught an exception during tf diff command: ${Utils.formatErrorMessage(err)}`);
            return [];
        }
        while (true) {
            const match: string[] = parseBriefDiffRegExp.exec(p4DiffResult);
            if (!match) {
                break;
            }
            const serverPath: string = match[1].trim();
            const changeType: string = match[3].trim();
            if (!(serverPath in this._cache)) {
                try {
                    const filePathOutput = await cp.exec(`"${this.p4Path}" -c ${this.p4Client} where ${serverPath}`);
                    const matchFile: string[] = filePathOutput.stdout.toString("utf8").trim().split(" ");
                    const localFile: string = matchFile[2].trim().toLowerCase();
                    const wsRoot: string = this.workspaceRootPath.toLowerCase();
                    if (localFile.startsWith(wsRoot)) {
                        this.tryPushCvsResource(localResources, changeType, matchFile[2].trim(), serverPath);
                        this._cache[serverPath] = matchFile[2].trim();
                    }
                } catch (err) {
                    continue
                }
            } else {
                try {
                    this.tryPushCvsResource(localResources, changeType, this._cache[serverPath], serverPath);
                } catch (err) {
                    continue;
                }
            }
        }
        Logger.logDebug(`P4SupportProvider#getLocalResources: ${localResources.length} changed resources was detected`);
        return localResources;
    }

    private tryPushCvsResource(resources: CvsResource[], changeType: string, fileAbsPath: string, serverFilePath: string): void {
        try {
            let resource: CvsResource = this.getCvsResource(changeType, fileAbsPath);
            resource.serverFilePath = `perforce://${this.p4Client}://${serverFilePath}`;
            resources.push(resource);
        } catch (err) {
            Logger.logError(Utils.formatErrorMessage(err));
        }
    }

    private getCvsResource(changeType: string, fileAbsPath: string): CvsResource {
        const relativePath: string = path.relative(this.getRootPath(), fileAbsPath);
        let resource: CvsResource;
        if (changeType.indexOf(P4ChangeType.ADD) !== -1) {
            resource = new AddedCvsResource(fileAbsPath, relativePath);
        } else if (changeType.indexOf(P4ChangeType.EDIT) !== -1) {
            resource = new ModifiedCvsResource(fileAbsPath, relativePath);
        }
        return resource;
    }

    public getRootPath(): string {
        return this.workspaceRootPath;
    }
}

class P4ChangeType {
    public static readonly ADD = "add";
    public static readonly EDIT = "edit";
}
