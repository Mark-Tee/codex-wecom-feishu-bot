/**
 * 平台适配器契约。
 * 新平台（飞书等）只负责收发消息和媒体，不实现值班业务规则。
 *
 * @typedef {Object} IncomingMessage
 * @property {string} id
 * @property {string} chatId
 * @property {string} userId
 * @property {"text"|"image"|"mixed"} type
 * @property {string} text
 * @property {Array<{path:string,text?:string}>} images
 * @property {string} receivedAt
 *
 * @typedef {Object} PlatformAdapter
 * @property {() => Promise<void>} start
 * @property {(message: IncomingMessage) => Promise<void>} handle
 * @property {(chatId:string, text:string) => Promise<void>} sendText
 * @property {(chatId:string, text:string, finishing?:boolean) => Promise<void>} sendProgress
 */

export const PLATFORM_METHODS = ["start", "stop", "handle", "sendText", "sendProgress"];

export function assertPlatformAdapter(adapter) {
  for (const method of PLATFORM_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`平台适配器缺少方法：${method}`);
    }
  }
}
