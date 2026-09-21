/** Build identity stamped by the Cloudflare CDN adapter on page responses. */
export declare const VINEXT_CDN_BUILD_ID_HEADER = "X-Vinext-Build-Id";
/** Opaque identity shared by every server entry emitted by one vinext build. */
export declare function getVinextCdnBuildIdentity(): string | null;
