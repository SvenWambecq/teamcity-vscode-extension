"use strict";

import { window, MessageItem } from "vscode";
import { Strings } from "../utils/strings";
import { Logger } from "../utils/logger";
import { Credential } from "../credentialstore/credential";
import { ChangeItemProxy, BuildItemProxy } from "../notifications/summarydata";
import XHR = require("xmlhttprequest");
import pako = require("pako");

export class VsCodeUtils {

    public static async showErrorMessage(messageToDisplay: string, ...messageItems : MessageItem[]) : Promise<MessageItem> {
        return await window.showErrorMessage(messageToDisplay, ...messageItems);
    }

    public static async showInfoMessage(messageToDisplay: string, ...messageItems : MessageItem[]) : Promise<MessageItem> {
        return await window.showInformationMessage(messageToDisplay, ...messageItems);
    }

    public static async showWarningMessage(messageToDisplay: string, ...messageItems : MessageItem[]) : Promise<MessageItem> {
        return await window.showWarningMessage(messageToDisplay, ...messageItems);
    }

    public static async displayNoCredentialsMessage(): Promise<void> {
        const displayError: string = Strings.NO_CREDENTIALS_RUN_SIGNIN;
        VsCodeUtils.showErrorMessage(displayError);
    }

    public static async displayNoSelectedConfigsMessage(): Promise<void> {
        const displayError: string = Strings.NO_CONFIGS_RUN_REMOTERUN;
        VsCodeUtils.showErrorMessage(displayError);
    }

    public static async displayNoTccUtilMessage(): Promise<void> {
        const displayError: string = Strings.NO_TCC_UTIL;
        VsCodeUtils.showErrorMessage(displayError);
    }

    /**
     * @param value - any string in the format ${value1:value2}
     * @return - an array in the format ${[value1, value2]}
     */
    public static parseValueColonValue(value : string) : string[] {
        const KEY_SEPARATOR : string = ":";
        if (value === undefined || !value.indexOf(KEY_SEPARATOR)) {
            Logger.logWarning(`VsCodeUtils#parseValueColonValue: value ${value} wasn't parsed`);
            return undefined;
        }
        const keys = value.split(KEY_SEPARATOR);
        return keys.length !== 2 ? undefined : keys;
    }

    public static gzip2Str(gzip : Uint8Array[]) : string {
        Logger.logDebug(`VsCodeUtils#gzip2Str: starts unziping gzip`);
        const buffer : string[] = [];
        // Pako magic
        const inflatedGzip : Uint16Array = pako.inflate(gzip);
        // Convert gunzipped byteArray back to ascii string:
        for (let i : number = 0; i < inflatedGzip.byteLength; i = i + 200000) {
            /*RangeError: Maximum call stack size exceeded when i is between 250000 and 260000*/
            const topIndex = Math.min(i + 200000, inflatedGzip.byteLength);
            /* tslint:disable:no-null-keyword */
            buffer.push(String.fromCharCode.apply(null, new Uint16Array(inflatedGzip.slice(i, topIndex))));
            /* tslint:enable:no-null-keyword */
        }
        Logger.logDebug(`VsCodeUtils#gzip2Str: finishes unziping gzip`);
        return buffer.join("");
    }

        /**
     * @param method - type of request (GET, POST, ...)
     * @param url - url of request
     * @param cred? - Credential for basic authorization
     * @return Promise with request.response in case of success, otherwise a reject with status of response and statusText.
     */
    public static makeRequest(method, url : string, cred? : Credential) {
        Logger.logDebug(`VsCodeUtils#makeRequest: url: ${url} by ${method}`);
        const XMLHttpRequest = XHR.XMLHttpRequest;
        return new Promise(function (resolve, reject) {
            const request : XHR.XMLHttpRequest = new XMLHttpRequest();
            request.open(method, url, true);
            if (cred) {
                Logger.logDebug(`VsCodeUtils#makeRequest: creds:`);
                Logger.LogObject(cred);
                request.setRequestHeader("Authorization", "Basic " + new Buffer(cred.user + ":" + cred.pass).toString("base64"));
            }
            request.onload = function () {
                if (this.status >= 200 && this.status < 300) {
                    resolve(request.response);
                } else {
                    reject({
                        status: this.status,
                        statusText: request.statusText
                    });
                }
            };
            request.onerror = function () {
                reject({
                    status: this.status,
                    statusText: request.statusText
                });
            };
            request.send();
        });
    }

    /**
     * This method prepares message to display from change items and user credential.
     * @param change - changeItemProxy
     * @param cred - user credential. Required to get serverUrl.
     */
    public static formMessage(change : ChangeItemProxy, cred : Credential) : string {
        const changePrefix = change.isPersonal ? "Personal change" : "Change";
        const messageSB : string[] = [];
        messageSB.push(`${changePrefix} #${change.changeId} has "${change.status}" status.`);
        const builds : BuildItemProxy[] = change.builds;
        if (builds) {
            builds.forEach((build) => {
                const buildPrefix = build.isPersonal ? "Personal build" : "Build";
                const buildChangeUrl = `${cred.serverURL}/viewLog.html?buildId=${build.buildId}`;
                if (build.buildId !== -1) {
                    messageSB.push(`${buildPrefix} #${build.buildId} has "${build.status}" status. More detales: ${buildChangeUrl}`);
                }
            });
        }
        return messageSB.join("\n");
    }

    /**
     * Prepares an error for writting into log
     * @param err - an error
     */
    public static formatErrorMessage(err) : string {
        if (!err || !err.message) {
            return "";
        }
        let formattedMsg : string = err.message;
        if (err.stderr) {
            formattedMsg = `${formattedMsg} ${err.stderr}`;
        }
        return formattedMsg;
    }
}
