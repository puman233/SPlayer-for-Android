import {
  DialogApi,
  LoadingBarApi,
  MessageApi,
  ModalApi,
  ModalOptions,
  ModalReactive,
  NotificationApi,
} from "naive-ui";

// 扩展 ModalApi.create 支持 _backable：false 表示安卓返回键吞但不关闭
type ExtendedModalOptions = ModalOptions & { _backable?: boolean };

interface ExtendedModalApi extends Omit<ModalApi, "create"> {
  create(options: ExtendedModalOptions): ModalReactive;
}

declare global {
  interface Window {
    // naiveui
    $message: MessageApi;
    $dialog: DialogApi;
    $notification: NotificationApi;
    $loadingBar: LoadingBarApi;
    $modal: ExtendedModalApi;
    // electron
    api: {
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: unknown) => Promise<boolean>;
        has: (key: string) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
        reset: (keys?: string[]) => Promise<boolean>;
        export: (data: any) => Promise<{ success: boolean; path?: string; error?: string }>;
        import: () => Promise<{ success: boolean; data?: any; error?: string }>;
      };
    };
    // logs
    logger: {
      info: (message: string, ...args: unknown[]) => void;
      warn: (message: string, ...args: unknown[]) => void;
      error: (message: string, ...args: unknown[]) => void;
      debug: (message: string, ...args: unknown[]) => void;
    };
  }
}
