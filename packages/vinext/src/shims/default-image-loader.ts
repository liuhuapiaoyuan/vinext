/**
 * Default image loader for next/image.
 *
 * When `images.loaderFile` is configured in next.config.js, vinext aliases
 * this module to the user's custom loader at build time (mirroring Next.js).
 */
import { imageOptimizationUrl } from "./image-optimization-url.js";

export default function defaultImageLoader({
  src,
  width,
  quality = 75,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  return imageOptimizationUrl(src, width, quality);
}
