import { createParser } from "eventsource-parser";
import got from "got";
import fetch, { RequestInit } from "node-fetch";
import { isReadable, Readable } from "stream";

interface FetchSSEOptions extends RequestInit {
  onMessage(data: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError(error: any): void;
}

export async function fetchSSE(input: string, options: FetchSSEOptions) {
  const proxy = "socks5://localhost:1080";

  const { onMessage, onError, signal: originSignal, ...fetchOptions } = options;
  const timeout = 60 * 1000;
  let abortByTimeout = false;
  try {

    const stream = got.stream.post(input, {
      headers: fetchOptions.headers as any,
      body: fetchOptions.body,
    });

    if (originSignal) {
      originSignal.addEventListener("abort", () =>
        stream.destroy());
    }
    const timerId = setTimeout(() => {
      abortByTimeout = true;
      stream.destroy();
    }, timeout);

    const parser = createParser((event) => {
      if (event.type === "event") {
        onMessage(event.data);
      }
    });

    stream.on("data", (chunk) => {
      if (chunk) {
        const str = new TextDecoder().decode(chunk as ArrayBuffer);
        parser.feed(str);
      }
    });

    stream.on("error", (err) => {
      if (abortByTimeout) {
        onError({ error: { message: "Connection Timeout" } });
      } else {
        onError({ err });
      }
    });

    return new Promise<void>((resolve) => {
      stream.on("end", () => {
        clearTimeout(timerId);
        resolve();
      });
    })

  } catch (error) {
    if (abortByTimeout) {
      onError({ error: { message: "Connection Timeout" } });
    } else {
      onError({ error });
    }
  }
}
