import { Home, Library, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { Tab } from "../types";

export function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

export function MobileTopNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  return (
    <header className="mobile-top-nav">
      <button className="mobile-brand" onClick={() => setTab("home")} aria-label="打开首页">
        <img src="/assets/icon.png" alt="" />
        <span>既见</span>
      </button>
      <nav aria-label="主导航">
        <NavButton active={tab === "home"} icon={<Home />} label="首页" onClick={() => setTab("home")} />
        <NavButton active={tab === "search"} icon={<Search />} label="搜索" onClick={() => setTab("search")} />
        <NavButton active={tab === "mine"} icon={<Library />} label="我的" onClick={() => setTab("mine")} />
      </nav>
    </header>
  );
}
