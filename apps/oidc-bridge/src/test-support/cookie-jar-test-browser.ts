interface StoredCookie {
  value: string;
  path: string;
}

export interface BrowserResponse {
  status: number;
  /** URL của trang cuối sau khi theo redirect; hoặc đích của redirect đi ra ngoài origin. */
  url: string;
  headers: Headers;
  body: string;
  /** Header Set-Cookie của response cuối. */
  setCookies: string[];
}

/**
 * Trình duyệt tối thiểu cho test tích hợp: giữ cookie theo path, tự theo
 * redirect trong phạm vi `stayOnOrigin` và dừng ở redirect đầu tiên đi ra ngoài
 * (ví dụ callback của Outline, không có server thật trong test).
 */
export class CookieJarTestBrowser {
  private readonly cookies = new Map<string, StoredCookie>();
  private readonly stayOnOrigin: string;

  constructor(stayOnOrigin: string) {
    this.stayOnOrigin = stayOnOrigin;
  }

  /** Chép cookie sang trình duyệt khác (mô phỏng cookie bị lấy cắp). */
  copyCookiesTo(other: CookieJarTestBrowser): void {
    for (const [name, cookie] of this.cookies)
      other.cookies.set(name, { ...cookie });
  }

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }

  private store(setCookies: string[]): void {
    for (const header of setCookies) {
      const [pair = "", ...attributes] = header
        .split(";")
        .map((part) => part.trim());
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      const attribute = (key: string) =>
        attributes
          .find((item) => item.toLowerCase().startsWith(`${key}=`))
          ?.slice(key.length + 1);
      const expires = attribute("expires");
      const expired =
        value === "" ||
        attribute("max-age") === "0" ||
        (expires !== undefined && new Date(expires).getTime() <= Date.now());
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: attribute("path") ?? "/" });
    }
  }

  private cookieHeaderFor(url: URL): string {
    return [...this.cookies]
      .filter(([, cookie]) => url.pathname.startsWith(cookie.path))
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join("; ");
  }

  private async request(
    url: string,
    init: RequestInit,
  ): Promise<BrowserResponse> {
    let current = new URL(url);
    let requestInit = init;
    for (let hop = 0; hop < 10; hop += 1) {
      const response = await fetch(current, {
        ...requestInit,
        redirect: "manual",
        headers: {
          ...requestInit.headers,
          cookie: this.cookieHeaderFor(current),
          // Không giữ kết nối: sau khi test restart bridge, socket cũ đã chết.
          connection: "close",
        },
      });
      const setCookies = response.headers.getSetCookie();
      this.store(setCookies);

      const location = response.headers.get("location");
      const next = location ? new URL(location, current) : undefined;
      if (!next || response.status < 300 || response.status >= 400) {
        return {
          status: response.status,
          url: current.href,
          headers: response.headers,
          body: await response.text(),
          setCookies,
        };
      }
      if (next.origin !== this.stayOnOrigin) {
        return {
          status: response.status,
          url: next.href,
          headers: response.headers,
          body: "",
          setCookies,
        };
      }
      current = next;
      requestInit = {}; // Sau redirect là GET, không mang body/Referer cũ.
    }
    throw new Error("too many redirects");
  }

  get(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<BrowserResponse> {
    return this.request(url, { headers });
  }

  postForm(
    url: string,
    fields: Record<string, string>,
  ): Promise<BrowserResponse> {
    return this.request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }
}
