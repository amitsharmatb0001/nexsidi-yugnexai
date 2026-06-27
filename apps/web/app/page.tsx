import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import s from "./landing.module.css";

export default function Home() {
  return (
    <main className={s.root}>
      <nav className={s.nav}>
        <div className={s.navBrand}>
          <div className={s.navLogo}>N</div>
          NexSidi
        </div>
        <SignedOut>
          <SignInButton mode="modal">
            <button className={s.signInBtn}>Sign in</button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link href="/dashboard" className={s.dashLink}>
            Dashboard
            <i className="nxi nxi-arrow-r" style={{ fontSize:13, marginLeft:4 }} />
          </Link>
        </SignedIn>
      </nav>

      <div className={s.hero}>
        <div className={s.badge}>
          <span className={s.badgeDot} />
          Autonomous · Multi-Agent · Production-Ready
        </div>

        <h1 className={s.headline}>
          Describe your app.<br />Get it running.
        </h1>

        <p className={s.subline}>
          NexSidi turns a plain-English description into a complete,
          working application — design, backend, database, deployment.
        </p>

        <div className={s.cta}>
          <SignedOut>
            <SignInButton mode="modal">
              <button className={s.ctaPrimary}>
                Start building
                <i className="nxi nxi-arrow-r" style={{ fontSize:14 }} />
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link href="/dashboard" className={s.ctaPrimary}>
              Go to Dashboard
              <i className="nxi nxi-arrow-r" style={{ fontSize:14 }} />
            </Link>
          </SignedIn>
          <Link href="/compare" className={s.ctaSecondary}>
            <i className="nxi nxi-code" style={{ fontSize:14 }} />
            See our design system
          </Link>
        </div>
      </div>
    </main>
  );
}
