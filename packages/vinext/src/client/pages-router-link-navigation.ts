type PagesRouterLinkTransitionOptions = {
  scroll?: boolean;
  locale?: string | false;
};

type PagesRouterLinkRuntime = {
  push(url: string, as?: string, options?: PagesRouterLinkTransitionOptions): Promise<boolean>;
  replace(url: string, as?: string, options?: PagesRouterLinkTransitionOptions): Promise<boolean>;
};

export async function navigatePagesRouterLink(
  router: PagesRouterLinkRuntime,
  {
    href,
    replace,
    scroll,
    locale,
  }: {
    href: string;
    replace: boolean;
    scroll: boolean;
    locale?: string | false;
  },
): Promise<void> {
  const routerOptions = { scroll, locale };
  if (replace) {
    await router.replace(href, undefined, routerOptions);
  } else {
    await router.push(href, undefined, routerOptions);
  }
}
