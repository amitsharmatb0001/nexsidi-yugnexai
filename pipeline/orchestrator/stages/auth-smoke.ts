// Auth smoke test — a deterministic sign-up -> sign-in -> sign-out check that
// Stage 6 runs with its other cheap checks, before the expensive live review.
//
// Why: project a034f90ba50e lost 3-4 full review rounds (20-60 min each) to
// auth that was broken in the UI while the backend worked — an /api proxy that
// returned 500, and a sign-in that left the user on the sign-in page. A plain
// script finds that class of bug in under a minute.
//
// It FAILS only on definite evidence:
//   - the sign-up form did not create the account (the backend rejects the
//     same credentials with 401/403/404)
//   - after signing in, the browser is still on the sign-in page
//   - after Sign Out, the readable `token` cookie is still set
// Everything uncertain is a SKIP (ran:false, pass:true): no auth endpoints, no
// auth pages, a form without an email field, a login API that rejects the
// request shape, or any browser/network error. A skip never blocks a build —
// the full review still runs.

export interface AuthSmokeResult {
  ran: boolean;
  pass: boolean;
  findings: string[];
  skippedReason?: string;
}

export interface BrowserLike {
  send(action: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface AuthSmokeOptions {
  appUrl: string;
  backendUrl: string;
  endpoints: Array<{ method: string; path: string }>;
  browser: BrowserLike;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const SIGN_IN_TEXT = /^(sign ?in|log ?in)$/i;
const SIGN_UP_TEXT = /^(sign ?up|register|get started|create (an )?account)$/i;
const SIGN_IN_FALLBACKS = ["/sign-in", "/signin", "/login"];
const SIGN_UP_FALLBACKS = ["/sign-up", "/signup", "/register"];

const skip = (reason: string): AuthSmokeResult => ({ ran: false, pass: true, findings: [], skippedReason: reason });
const fail = (finding: string): AuthSmokeResult => ({ ran: true, pass: false, findings: [finding] });

// Only endpoints the contract really has — no guessed defaults, so an app
// without auth is skipped instead of tested against paths it never had.
function contractAuthPaths(endpoints: AuthSmokeOptions["endpoints"]): { loginPath: string } | null {
  const posts = endpoints.filter((e) => e.method.toUpperCase() === "POST").map((e) => e.path);
  const lastSeg = (p: string) => p.replace(/\/$/, "").split("/").pop()!.toLowerCase().replace(/[-_]/g, "");
  const register = posts.find((p) => ["register", "signup"].includes(lastSeg(p)));
  const login = posts.find((p) => ["login", "signin"].includes(lastSeg(p)));
  return register && login ? { loginPath: login } : null;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

async function evaluate(browser: BrowserLike, expression: string): Promise<unknown> {
  const res = (await browser.send("evaluate", { expression })) as { value?: unknown } | undefined;
  return res?.value;
}

async function hasPasswordField(browser: BrowserLike, url: string): Promise<boolean> {
  await browser.send("navigate", { url });
  const res = (await browser.send("exists", { selector: "input[type=password]" })) as { exists?: boolean } | undefined;
  return res?.exists === true;
}

async function findAuthPage(browser: BrowserLike, appUrl: string, links: Array<{ text: string; href: string }>, text: RegExp, fallbacks: string[]): Promise<string | null> {
  const fromLinks = links.filter((l) => text.test(l.text.trim()) && l.href.startsWith("/")).map((l) => trimSlash(l.href.split(/[?#]/)[0]!));
  for (const path of [...new Set([...fromLinks, ...fallbacks])]) {
    if (await hasPasswordField(browser, appUrl + path)) return path;
  }
  return null;
}

function fillFormExpression(email: string, password: string): string {
  return `/*fill*/ (() => {
    const pw = document.querySelector('input[type=password]');
    const form = (pw && pw.closest('form')) || document;
    const setValue = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    let filled = 0, hasEmail = false;
    for (const el of form.querySelectorAll('input, textarea, select')) {
      if (el.disabled || ['hidden', 'submit', 'button'].includes(el.type)) continue;
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find((o) => o.value);
        if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); filled++; }
        continue;
      }
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.required && !el.checked) el.click(); continue; }
      const hint = (el.name + ' ' + el.id + ' ' + el.placeholder).toLowerCase();
      const isEmail = el.type === 'email' || hint.includes('email');
      const v = isEmail ? ${JSON.stringify(email)}
        : el.type === 'password' ? ${JSON.stringify(password)}
        : el.type === 'number' ? '1'
        : el.type === 'tel' ? '5555550100'
        : el.type === 'date' ? new Date().toISOString().slice(0, 10)
        : 'Test User';
      if (isEmail) hasEmail = true;
      setValue(el, v);
      filled++;
    }
    return { filled, hasEmail };
  })()`;
}

const SUBMIT_EXPRESSION = `/*submit*/ (() => {
  const pw = document.querySelector('input[type=password]');
  const form = pw && pw.closest('form');
  if (!form) return false;
  const btn = form.querySelector('button[type=submit], input[type=submit]') || form.querySelector('button');
  if (btn) { btn.click(); return true; }
  form.requestSubmit();
  return true;
})()`;

const SIGN_OUT_EXPRESSION = `/*signout*/ (() => {
  const el = [...document.querySelectorAll('button, a')].find((e) => /^(sign|log) ?out$/i.test((e.textContent || '').trim()));
  if (!el) return false;
  el.click();
  return true;
})()`;

// Uses Next.js's own client router when present (window.next.router); on any
// other app it does nothing and returns 0.
function prefetchExpression(paths: string[]): string {
  return `/*prefetch*/ (async () => {
    const router = window.next && window.next.router;
    if (!router || typeof router.prefetch !== 'function') return 0;
    for (const p of ${JSON.stringify(paths)}) { try { router.prefetch(p); } catch (e) {} }
    await new Promise((r) => setTimeout(r, 1500));
    return ${paths.length};
  })()`;
}

const TOKEN_COOKIE_EXPRESSION = `/*cookie*/ /(?:^|;\\s*)token=[^;]+/.test(document.cookie)`;

async function fillAndSubmit(browser: BrowserLike, email: string, password: string): Promise<string | null> {
  const fill = (await evaluate(browser, fillFormExpression(email, password))) as { hasEmail?: boolean } | undefined;
  if (!fill?.hasEmail) return "the form has no email field";
  if ((await evaluate(browser, SUBMIT_EXPRESSION)) !== true) return "the form has no submit control";
  return null;
}

export async function runAuthSmokeTest(opts: AuthSmokeOptions): Promise<AuthSmokeResult> {
  const { appUrl, backendUrl, endpoints, browser } = opts;
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const auth = contractAuthPaths(endpoints);
  if (!auth) return skip("the API contract has no sign-up and sign-in endpoints");

  const stamp = Date.now();
  const email = `smoke+${stamp}@example.com`;
  const password = `Smoke!${stamp}aA1`;

  try {
    await browser.send("navigate", { url: appUrl });
    const links = ((await evaluate(browser, `/*links*/ [...document.querySelectorAll('a[href]')].map((a) => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') || '' }))`)) ?? []) as Array<{ text: string; href: string }>;
    const signUpPath = await findAuthPage(browser, appUrl, links, SIGN_UP_TEXT, SIGN_UP_FALLBACKS);
    const signInPath = await findAuthPage(browser, appUrl, links, SIGN_IN_TEXT, SIGN_IN_FALLBACKS);
    if (!signUpPath || !signInPath) return skip("could not find both a sign-up and a sign-in page");

    // 1. Sign up through the UI, then ask the backend whether the account exists.
    await browser.send("navigate", { url: appUrl + signUpPath });
    const signUpProblem = await fillAndSubmit(browser, email, password);
    if (signUpProblem) return skip(`sign-up page: ${signUpProblem}`);
    await sleep(4000);
    const login = await fetchFn(backendUrl + auth.loginPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if ([401, 403, 404].includes(login.status)) {
      return fail(`The sign-up form at ${signUpPath} did not create the account: signing in with the details it was given returns HTTP ${login.status} from ${auth.loginPath}. Check that the form posts to the backend's sign-up endpoint and that the request succeeds in the browser.`);
    }
    if (!login.ok) return skip(`the login API answered ${login.status} — cannot judge the sign-up form`);

    // 2. Sign in through the UI in a clean session. First prefetch the app's
    //    own links and /dashboard while signed out, as a real browser does for
    //    visible links — otherwise a router.push after sign-in can look fine
    //    here and still strand real users on the sign-in page.
    await browser.send("newSession");
    await browser.send("navigate", { url: appUrl + signInPath });
    const internal = links.map((l) => l.href.split(/[?#]/)[0]!).filter((h) => h.startsWith("/") && h !== signInPath && h !== signUpPath);
    await evaluate(browser, prefetchExpression([...new Set([...internal, "/dashboard"])]));
    const signInProblem = await fillAndSubmit(browser, email, password);
    if (signInProblem) return skip(`sign-in page: ${signInProblem}`);
    await sleep(6000);
    const current = (await browser.send("currentUrl")) as { url?: string } | undefined;
    const currentPath = trimSlash(new URL(current?.url ?? appUrl).pathname);
    if (currentPath === signInPath) {
      return fail(`After a successful sign-in the user is still on the sign-in page (${signInPath}): the backend accepts these credentials, but the page never moves on. After the token cookie is set, navigate with window.location.assign(...) — router.push can reuse a page prefetched while signed out.`);
    }

    // 3. Sign out, if the app offers it, and check the session really ended.
    if ((await evaluate(browser, SIGN_OUT_EXPRESSION)) === true) {
      await sleep(3000);
      if ((await evaluate(browser, TOKEN_COOKIE_EXPRESSION)) === true) {
        return fail("Sign Out did not end the session: the token cookie is still set after clicking it. Clear the cookie, then navigate with window.location.assign(...).");
      }
    }

    return { ran: true, pass: true, findings: [] };
  } catch (err) {
    return skip(`browser error: ${String(err).slice(0, 200)}`);
  }
}
