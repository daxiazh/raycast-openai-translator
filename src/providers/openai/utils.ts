import { createParser } from "eventsource-parser";
import fetch, { RequestInit } from "node-fetch";
import { isReadable, Readable } from "stream";

interface FetchSSEOptions extends RequestInit {
  onMessage(data: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError(error: any): void;
}

export async function fetchSSE(url: string, options: FetchSSEOptions) {
  // console.log("开始请求: " + input);
  // 去掉不可见的符号, 这会在某些机器上导致 url 识别出错
  url = url.replace(/\u200B/g, "").trim();

  const { onMessage, onError, signal: originSignal, ...fetchOptions } = options;
  const timeout = 15 * 1000;
  let abortByTimeout = false;
  try {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    if (originSignal) {
      originSignal.addEventListener("abort", () => ctrl.abort());
    }
    const timerId = setTimeout(() => {
      abortByTimeout = true;
      ctrl.abort();
    }, timeout);

    const resp = await fetch(url, { ...fetchOptions, signal });

    clearTimeout(timerId);

    if (resp.status !== 200) {
      onError(await resp.json());
      return;
    }
    const parser = createParser((event) => {
      if (event.type === "event") {
        onMessage(event.data);
      }
    });
    if (resp.body) {
      for await (const chunk of resp.body) {
        if (chunk) {
          const str = new TextDecoder().decode(chunk as ArrayBuffer);
          parser.feed(str);
        }
      }
    }
  } catch (error) {
    if (abortByTimeout) {
      onError({ error: { message: "Connection Timeout" } });
    } else {
      onError({ error });
    }
  }
}
