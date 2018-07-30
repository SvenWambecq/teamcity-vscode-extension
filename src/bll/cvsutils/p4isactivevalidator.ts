import { Validator } from "./validator";
import { CpProxy } from "../moduleproxies/cp-proxy";
import { Constants } from "../utils/constants";
import { WorkspaceProxy } from "../moduleproxies/workspace-proxy";

export class P4IsActiveValidator implements Validator {

    private readonly p4Path: string;
    private readonly workspaceRootPath: string;
    private readonly workspaceProxy: WorkspaceProxy;
    private readonly cpProxy: CpProxy;

    constructor(p4Path: string, workspaceRootPath: string, cpProxy?: CpProxy) {
        this.p4Path = p4Path;
        this.workspaceRootPath = workspaceRootPath;
        this.workspaceProxy = new WorkspaceProxy()
        this.cpProxy = cpProxy || new CpProxy();
    }

    public async validate(): Promise<void> {
        return this.checkIsP4Repository();
    }

    private async checkIsP4Repository(): Promise<void> {
        const client: string = this.workspaceProxy.getConfigurationValue(Constants.P4_WORKSPACE);
        const briefDiffCommand: string = `"${this.p4Path}" -c ${client} where ${this.workspaceRootPath}`;
        try {
            await this.cpProxy.execAsync(briefDiffCommand);
        } catch (err) {
            throw new Error("P4 repository was not determined");
        }
    }
}
