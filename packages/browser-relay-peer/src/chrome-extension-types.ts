export interface ChromeRuntimeMessageSenderLike {
  tab?: {
    id?: number;
    url?: string;
    title?: string;
  };
  frameId?: number;
}

export interface ChromeRuntimeLike {
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: ChromeRuntimeMessageSenderLike,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ): void;
  };
}

export interface ChromeTabLike {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  status?: "complete" | "loading";
  active?: boolean;
  discarded?: boolean;
}

export interface ChromeExtensionPlatform {
  runtime: ChromeRuntimeLike;
  queryTabs(query: {
    active?: boolean;
    currentWindow?: boolean;
  }): Promise<ChromeTabLike[]>;
  getTab(tabId: number): Promise<ChromeTabLike | null>;
  updateTab(tabId: number, updateProperties: {
    url?: string;
    active?: boolean;
  }): Promise<ChromeTabLike>;
  createTab(createProperties: {
    url: string;
    active?: boolean;
  }): Promise<ChromeTabLike>;
  sendTabMessage<T>(tabId: number, message: unknown): Promise<T>;
  captureVisibleTab(windowId?: number, options?: { format?: "png" | "jpeg" }): Promise<string>;
}

export function getChromeExtensionPlatform(): ChromeExtensionPlatform {
  const chromeLike = (globalThis as Record<string, unknown>).chrome as {
    runtime?: {
      onMessage?: {
        addListener: ChromeRuntimeLike["onMessage"]["addListener"];
      };
    };
    tabs?: {
      query(
        query: { active?: boolean; currentWindow?: boolean },
        callback: (tabs: ChromeTabLike[]) => void
      ): void;
      get(tabId: number, callback: (tab?: ChromeTabLike) => void): void;
      update(
        tabId: number,
        updateProperties: { url?: string; active?: boolean },
        callback: (tab?: ChromeTabLike) => void
      ): void;
      create(
        createProperties: { url: string; active?: boolean },
        callback: (tab?: ChromeTabLike) => void
      ): void;
      sendMessage(tabId: number, message: unknown, callback: (response: unknown) => void): void;
      captureVisibleTab(
        windowId: number | undefined,
        options: { format?: "png" | "jpeg" } | undefined,
        callback: (dataUrl?: string) => void
      ): void;
    };
    runtimeLastError?: { message?: string };
  } | undefined;

  if (!chromeLike?.runtime?.onMessage || !chromeLike.tabs) {
    throw new Error("chrome extension APIs are not available in this runtime");
  }

  const withCallback = <T>(work: (callback: (value: T) => void) => void): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      work((value) => {
        const runtimeError = chromeLike.runtimeLastError;
        if (runtimeError?.message) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(value);
      });
    });

  return {
    runtime: {
      onMessage: {
        addListener: chromeLike.runtime.onMessage.addListener.bind(chromeLike.runtime.onMessage),
      },
    },
    queryTabs(query) {
      return withCallback((callback) => chromeLike.tabs!.query(query, callback));
    },
    async getTab(tabId) {
      return withCallback((callback) => chromeLike.tabs!.get(tabId, (tab) => callback(tab ?? null)));
    },
    updateTab(tabId, updateProperties) {
      return withCallback((callback) =>
        chromeLike.tabs!.update(tabId, updateProperties, (tab) => callback(tab ?? { id: tabId }))
      );
    },
    createTab(createProperties) {
      return withCallback((callback) =>
        chromeLike.tabs!.create(createProperties, (tab) => callback(tab ?? { url: createProperties.url }))
      );
    },
    sendTabMessage(tabId, message) {
      return withCallback((callback) => chromeLike.tabs!.sendMessage(tabId, message, callback as (response: unknown) => void));
    },
    captureVisibleTab(windowId, options) {
      return withCallback((callback) =>
        chromeLike.tabs!.captureVisibleTab(windowId, options, (dataUrl) => callback(dataUrl ?? ""))
      );
    },
  };
}
