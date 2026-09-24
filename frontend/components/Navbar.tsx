"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Tab = "home" | "inspect" | "queue" | "diff" | "history" | "manufacturers" | "rules";

interface NavbarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  reviewCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  reviewCount,
}) => {
  const router = useRouter();

  const navItems: { id: Tab; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "inspect", label: "Inspection" },
    { id: "diff", label: "Variance Studio" },
    { id: "history", label: "Product History" },
    { id: "manufacturers", label: "Manufacturer Audit" },
    { id: "queue", label: "Review Queue" },
    { id: "rules", label: "Rules" },
  ];

  const handleTabClick = (tab: Tab) => {
    if (tab === "home") {
      router.push("/");
    } else {
      // If we're on the landing page, navigate to /inspection first
      if (activeTab === "home") {
        router.push("/inspection");
      }
      setActiveTab(tab);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-seal shadow-md print:hidden">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-14 flex items-center justify-between gap-6">
          {/* Logo (Links back to Landing Page) */}
          <Link
            href="/"
            className="flex items-center gap-2 flex-shrink-0 group"
            title="CompliLens Home"
          >
            <span className="text-lg font-heading font-semibold text-white tracking-tight italic group-hover:text-wash transition-colors">
              CompliLens
            </span>
            <span className="text-[10px] font-mono text-white/50 hidden sm:inline">
              LMPC 2011
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;

              // "Home" is a Link, other tabs are buttons
              if (item.id === "home") {
                return (
                  <Link
                    key={item.id}
                    href="/"
                    className={`relative px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                      isActive
                        ? "text-white"
                        : "text-white/60 hover:text-white/90"
                    }`}
                  >
                    {item.label}
                    {isActive && (
                      <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-white/90 rounded-full" />
                    )}
                  </Link>
                );
              }

              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  className={`relative px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "text-white"
                      : "text-white/60 hover:text-white/90"
                  }`}
                >
                  {item.label}
                  {item.id === "queue" && reviewCount > 0 && (
                    <span className="ml-1 text-white/40">
                      ({reviewCount})
                    </span>
                  )}
                  {/* Active underline */}
                  {isActive && (
                    <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-white/90 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Mobile Navigation */}
          <div className="lg:hidden">
            <select
              value={activeTab}
              onChange={(e) => handleTabClick(e.target.value as Tab)}
              className="bg-seal-light border border-white/20 text-white rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none"
            >
              {navItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.id === "queue" && reviewCount > 0 ? ` (${reviewCount})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </header>
  );
};
