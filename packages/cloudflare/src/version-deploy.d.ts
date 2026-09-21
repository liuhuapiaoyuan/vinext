import { execFileSync } from "node:child_process";
import { type DeployOptions } from "./deploy.js";
export { parseWorkersDevUrl } from "./workers-dev-url.js";
export type WranglerVersionUploadResult = {
  versionId: string;
  previewUrl: string | null;
  workerName: string | null;
  output: string;
};
export type WranglerVersionDeployResult = {
  deployedUrl: string | null;
  output: string;
};
export type WranglerVersionTraffic = {
  versionId: string;
  percentage: number;
};
export type WranglerDeploymentStatus = {
  deploymentId: string | null;
  versions: WranglerVersionTraffic[];
  output: string;
};
type WranglerVersionArgs = {
  args: string[];
  env: string | undefined;
};
export declare function parseVersionId(output: string): string | null;
export declare function parseUploadedWorkerName(output: string): string | null;
export declare function parseWranglerVersionUploadOutput(
  output: string,
): WranglerVersionUploadResult;
export declare function buildWranglerVersionUploadArgs(
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose"> & {
    previewAlias?: string;
  },
): WranglerVersionArgs;
export declare function buildWranglerVersionDeployArgs(
  versionTraffic: readonly WranglerVersionTraffic[],
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose">,
): WranglerVersionArgs;
export declare function buildWranglerDeploymentsStatusArgs(
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose">,
): WranglerVersionArgs;
export declare function buildWranglerTriggersDeployArgs(
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose">,
): WranglerVersionArgs;
export declare function parseWranglerDeploymentStatusOutput(
  output: string,
): WranglerDeploymentStatus;
export declare function runWranglerVersionUpload(
  root: string,
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose"> & {
    previewAlias?: string;
  },
  execute?: typeof execFileSync,
): WranglerVersionUploadResult;
export declare function runWranglerVersionDeploy(
  root: string,
  versionTraffic: readonly WranglerVersionTraffic[],
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose">,
  phase?: "stage" | "promote-warmed" | "promote-uploaded",
  execute?: typeof execFileSync,
): WranglerVersionDeployResult;
export declare function runWranglerDeploymentStatus(
  root: string,
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose">,
  execute?: typeof execFileSync,
): WranglerDeploymentStatus;
export declare function runWranglerTriggersDeploy(
  root: string,
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose">,
  execute?: typeof execFileSync,
): WranglerVersionDeployResult;
