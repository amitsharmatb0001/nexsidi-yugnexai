import Link from "next/link";
import s from "./landing.module.css";
import ScrambleText from "@/components/effects/ScrambleText";

export default function Home() {
  return (
    <main className={s.root}>
      <nav className={s.nav}>
        <div className={s.navBrand}>
          <div className={s.navLogo}>Y</div>
          YugNex
        </div>
        <Link href="/sign-in" className={s.signInBtn}>Sign in</Link>
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
          YugNex turns a plain-English description into a complete,
          working application — design, backend, database, deployment.
          No setup. No config. One prompt.
        </p>

        <div className={s.cta}>
          <Link href="/sign-up" className={s.ctaPrimary}>Start building free<i className="nxi nxi-arrow-r" style={{ fontSize: 14 }} /></Link>
          <Link href="/compare" className={s.ctaSecondary}>
            <i className="nxi nxi-code" style={{ fontSize: 14 }} />
            View design system
          </Link>
        </div>

      </div>
    </main>
  );
}
