import { stripBasePath } from "../utils/base-path.js";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
  isImageOptimizationPath,
  type ImageConfig,
  type ImageHandlers,
} from "./image-optimization.js";
import { cloneRequestWithUrl } from "./request-pipeline.js";

type AssetFetcher = {
  fetch(request: Request): Promise<Response> | Response;
};

type ImagesBinding = {
  input(stream: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
    };
  };
};

export type AppRouterImageOptimizationEnv = {
  ASSETS?: AssetFetcher;
  IMAGES?: ImagesBinding;
};

/** Build image security/size config from Vite `define` env vars baked at build time. */
function createImageConfigFromEnv(): ImageConfig {
  return {
    deviceSizes: JSON.parse(
      process.env.__VINEXT_IMAGE_DEVICE_SIZES ?? JSON.stringify(DEFAULT_DEVICE_SIZES),
    ),
    imageSizes: JSON.parse(process.env.__VINEXT_IMAGE_SIZES ?? JSON.stringify(DEFAULT_IMAGE_SIZES)),
    qualities: JSON.parse(process.env.__VINEXT_IMAGE_QUALITIES ?? "null") ?? undefined,
    dangerouslyAllowSVG: process.env.__VINEXT_IMAGE_DANGEROUSLY_ALLOW_SVG === "true",
    dangerouslyAllowLocalIP: process.env.__VINEXT_IMAGE_DANGEROUSLY_ALLOW_LOCAL_IP === "true",
  };
}

/**
 * Serve `/_next/image` from the Worker ASSETS binding when available.
 *
 * The default App Router worker entry delegates here before the RSC handler so
 * production requests do not fall through to the dev-style redirect path (which
 * can emit http:// Locations behind TLS-terminating proxies).
 */
export async function handleAppRouterImageOptimizationRequest(
  request: Request,
  options: {
    basePath: string;
    env: AppRouterImageOptimizationEnv;
    /**
     * The next.config `images` config the build baked into the RSC entry. The
     * `define`d env vars above only carry sizes and the SVG/IP flags, so
     * `localPatterns` (and CSP/Content-Disposition/cache-lifetime settings)
     * have to come from here or this early dispatch would answer requests the
     * shared handler rejects.
     */
    imageConfig?: ImageConfig;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  const strippedPathname = stripBasePath(url.pathname, options.basePath);
  if (!isImageOptimizationPath(strippedPathname) || !options.env.ASSETS) {
    return null;
  }
  // Only a Next-format optimizer request belongs here. The same pathname can
  // also be claimed by an app route (which signals the Worker to serve the
  // source itself), and answering that one with the optimizer's parameter
  // validation would replace the route's response with a 400.
  if (!url.searchParams.has("url")) {
    return null;
  }

  const imageRequest =
    strippedPathname === url.pathname
      ? request
      : cloneRequestWithUrl(request, new URL(`${strippedPathname}${url.search}`, url).href);

  // Config wins over the baked env defaults, but only for the keys it sets:
  // a partial config must not blank out the sizes/env-derived flags.
  const imageConfig: ImageConfig = { ...createImageConfigFromEnv(), ...options.imageConfig };
  const allowedWidths = [
    ...(imageConfig.deviceSizes ?? DEFAULT_DEVICE_SIZES),
    ...(imageConfig.imageSizes ?? DEFAULT_IMAGE_SIZES),
  ];

  const handlers: ImageHandlers = {
    fetchAsset: (path) =>
      Promise.resolve(options.env.ASSETS!.fetch(new Request(new URL(path, request.url)))),
  };

  const imagesBinding = options.env.IMAGES;
  if (imagesBinding) {
    handlers.transformImage = async (body, { width, format, quality }) => {
      const result = await imagesBinding
        .input(body)
        .transform(width > 0 ? { width } : {})
        .output({ format, quality });
      return result.response();
    };
  }

  return handleImageOptimization(imageRequest, handlers, allowedWidths, imageConfig);
}
