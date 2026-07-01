import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import s from "./landing.module.css";
import ScrambleText from "@/components/effects/ScrambleText";

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
            <i className="nxi nxi-arrow-r" style={{ fontSize: 13, marginLeft: 5 }} />
          </Link>
        </SignedIn>
      </nav>

      <div className={s.hero}>
        <div className={s.badge}>
          <span className={s.badgeDot} />
          Autonomous · Multi-Agent · Production-Ready
        </div>

        <ScrambleText
          tag="h1"
          text={"Describe your app.\nGet it running."}
          speed={22}
          delay={200}
          className={s.headline}
        />

        <p className={s.subline}>
          NexSidi turns a plain-English description into a complete,
          working application — design, backend, database, deployment.
          No setup. No config. One prompt.
        </p>

        <div className={s.cta}>
          <SignedOut>
            <SignInButton mode="modal">
              <button className={s.ctaPrimary}>
                Start building free
                <i className="nxi nxi-arrow-r" style={{ fontSize: 14 }} />
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link href="/dashboard" className={s.ctaPrimary}>
              Open Dashboard
              <i className="nxi nxi-arrow-r" style={{ fontSize: 14 }} />
            </Link>
          </SignedIn>
          <Link href="/compare" className={s.ctaSecondary}>
            <i className="nxi nxi-code" style={{ fontSize: 14 }} />
            View design system
          </Link>
        </div>

        <div className={s.statsRow}>
          <div className={s.statItem}>
            <span className={s.statNum}>38</span>
            <span className={s.statLabel}>Specialist agents</span>
          </div>
          <div className={s.statDivider} />
          <div className={s.statItem}>
            <span className={s.statNum}>4</span>
            <span className={s.statLabel}>QA gates</span>
          </div>
          <div className={s.statDivider} />
          <div className={s.statItem}>
            <span className={s.statNum}>0</span>
            <span className={s.statLabel}>Manual steps</span>
          </div>
          <div className={s.statDivider} />
          <div className={s.statItem}>
            <span className={s.statNum}>∞</span>
            <span className={s.statLabel}>Iterations until perfect</span>
          </div>
        </div>
      </div>
    </main>
  );
}
