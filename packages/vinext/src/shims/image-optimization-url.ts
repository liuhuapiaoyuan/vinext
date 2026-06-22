/**
 * Build a `/_next/image` optimization URL.
 *
 * Shared by the next/image shim and the default image loader module so
 * `images.loaderFile` aliasing does not create a circular import.
 */
export function imageOptimizationUrl(src: string, width: number, quality: number = 75): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}
