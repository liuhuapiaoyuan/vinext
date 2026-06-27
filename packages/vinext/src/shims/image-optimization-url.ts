import { getDeploymentId } from "../utils/deployment-id.js";

function extractLocalDeploymentId(src: string): { src: string; deploymentId?: string } {
  let deploymentId = getDeploymentId();
  if (!src.startsWith("/") || src.startsWith("//")) return { src, deploymentId };

  const queryIndex = src.indexOf("?");
  if (queryIndex === -1) return { src, deploymentId };

  const params = new URLSearchParams(src.slice(queryIndex + 1));
  const sourceDeploymentId = params.get("dpl");
  if (!sourceDeploymentId) return { src, deploymentId };

  deploymentId = sourceDeploymentId;
  params.delete("dpl");
  const remainingQuery = params.toString();
  return {
    src: src.slice(0, queryIndex) + (remainingQuery ? `?${remainingQuery}` : ""),
    deploymentId,
  };
}

/**
 * Build a `/_next/image` optimization URL.
 *
 * Shared by the next/image shim and the default image loader module so
 * `images.loaderFile` aliasing does not create a circular import.
 *
 * In production (Cloudflare Workers), the worker intercepts this path and uses
 * the Images binding to resize/transcode on the fly. In dev, the Vite dev
 * server handles it as a passthrough (serves the original file).
 */
export function imageOptimizationUrl(src: string, width: number, quality: number = 75): string {
  const source = extractLocalDeploymentId(src);
  const deploymentQuery =
    source.src.startsWith("/") && source.deploymentId ? `&dpl=${source.deploymentId}` : "";
  return `/_next/image?url=${encodeURIComponent(source.src)}&w=${width}&q=${quality}${deploymentQuery}`;
}
