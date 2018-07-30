"use strict";

import { P4PathFinder } from "../../../src/bll/cvsutils/p4pathfinder";
import * as assert from "assert";
import { CpProxy } from "../../../src/bll/moduleproxies/cp-proxy";
import { anything, instance, mock, when } from "ts-mockito";
import { OsProxy } from "../../../src/bll/moduleproxies/os-proxy";
import { WorkspaceProxy } from "../../../src/bll/moduleproxies/workspace-proxy";

suite("P4 Path Finder", () => {
    test("should handle \"p4\" in path for win32", function (done) {
        const osMock: OsProxy = mock(OsProxy);
        when(osMock.platform()).thenReturn("win32");
        const osSpy: OsProxy = instance(osMock);

        const cpMock: CpProxy = mock(CpProxy);
        when(cpMock.execAsync(`"p4"`)).thenReturn(
            Promise.resolve<any>({
                stdout: "p4 found"
            })
        );
        const cpSpy: CpProxy = instance(cpMock);

        const workspaceMock = mock(WorkspaceProxy);
        const workspaceSpy = instance(workspaceMock);

        const p4PathFinder: P4PathFinder = new P4PathFinder(osSpy, cpSpy, workspaceSpy);
        p4PathFinder.find().then((p4Path) => {
            assert.equal(p4Path, "p4");
            done();
        }
        ).catch((err) => {
            done(err);
        });
    });

    test("should handle \"p4\" is not installed for win32", function (done) {
        const osMock: OsProxy = mock(OsProxy);
        when(osMock.platform()).thenReturn("win32");
        const osSpy: OsProxy = instance(osMock);

        const cpMock: CpProxy = mock(CpProxy);
        when(cpMock.execAsync(anything())).thenReturn(
            Promise.reject("Nothing")
        );
        const cpSpy: CpProxy = instance(cpMock);

        const workspaceMock = mock(WorkspaceProxy);
        const workspaceSpy = instance(workspaceMock);

        const p4PathFinder: P4PathFinder = new P4PathFinder(osSpy, cpSpy, workspaceSpy);
        p4PathFinder.find().then(() => {
            done("An error expected");
        }
        ).catch((err) => {
            assert.equal(err.message, "p4 command line util not found");
            done();
        });
    });

});
