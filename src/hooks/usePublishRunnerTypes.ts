import type { PublishTransactionRunOptions } from "@/lib/publishTransaction";

export interface TranslationMap {
  [key: string]: string | undefined;
}

export interface RunPublishOptions extends PublishTransactionRunOptions {}
