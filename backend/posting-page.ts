import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";

export class PostingError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function validatePostingUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 4096) {
    throw new PostingError("Provide a job URL of at most 4096 characters.", 400);
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new PostingError("Enter a complete job posting URL.", 400);
  }

  const isWebUrl = url.protocol === "https:" || url.protocol === "http:";
  const hasCredentials = url.username !== "" || url.password !== "";

  if (!isWebUrl || hasCredentials || url.port) {
    throw new PostingError("Use an HTTP or HTTPS link without credentials or a custom port.", 400);
  }

  url.hash = "";
  return url;
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return false;
  }

  // process also converts IPv4-mapped IPv6 before checking its range.
  return ipaddr.process(address).range() === "unicast";
}

// Resolve once and connect to that checked address, avoiding a second DNS lookup.
async function resolvePublicAddress(url: URL, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    function onAbort() {
      reject(new PostingError("Reading the posting timed out. Please try again.", 504));
    }

    signal.addEventListener("abort", onAbort, { once: true });

    lookup(hostname, { all: true }).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });

    if (signal.aborted) {
      onAbort();
    }
  });

  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new PostingError("Use a publicly accessible job posting URL.", 400);
  }

  return addresses[0];
}

interface PageResponse {
  html?: string;
  redirect?: string;
}

async function requestPage(url: URL, signal: AbortSignal): Promise<PageResponse> {
  const address = await resolvePublicAddress(url, signal);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.get(url, {
      signal,
      agent: false,
      family: address.family,
      lookup: (_hostname, _options, callback) => {
        callback(null, address.address, address.family);
      },
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "FindMyRec/0.1 (job posting reader)",
      },
    }, (response) => {
      const status = response.statusCode || 502;

      if ([301, 302, 303, 307, 308].includes(status)) {
        const redirect = response.headers.location;
        response.destroy();

        if (!redirect) {
          reject(new PostingError("The job site sent an invalid redirect.", 502));
          return;
        }

        resolve({ redirect });
        return;
      }

      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new PostingError(`The job site returned HTTP ${status}. It may block automated access or the posting may have expired.`, 502));
        return;
      }

      const contentType = response.headers["content-type"] || "";

      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        response.destroy();
        reject(new PostingError("This link didn't return an HTML job page.", 422));
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;

      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;

        if (bytes > 2_000_000) {
          response.destroy();
          reject(new PostingError("The job page is too large to read.", 422));
          return;
        }

        chunks.push(chunk);
      });

      response.on("end", () => {
        resolve({ html: Buffer.concat(chunks).toString("utf8") });
      });

      response.on("error", reject);
    });

    request.on("error", reject);
  });
}

export async function readPostingPage(value: unknown) {
  let url = validatePostingUrl(value);
  const signal = AbortSignal.timeout(15000);

  try {
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const page = await requestPage(url, signal);

      if (page.html !== undefined) {
        return { html: page.html, sourceUrl: url.href };
      }

      // Every redirect receives the same URL and public-address checks.
      url = validatePostingUrl(new URL(page.redirect!, url).href);
    }

    throw new PostingError("The job site redirected too many times.", 502);
  } catch (error) {
    if (error instanceof PostingError) {
      throw error;
    }

    if (signal.aborted) {
      throw new PostingError("Reading the posting timed out. Please try again.", 504);
    }

    throw new PostingError("Couldn't reach the job site. Check the link and try again.", 502);
  }
}
