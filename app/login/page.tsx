"use client";

import { useEffect, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { Button, Field, Spinner, inputClass } from "@/components/ui";
import { homeForRole, type Role } from "@/lib/auth/roles";
import { notify } from "@/lib/toast";

type Mode = "loading" | "login" | "setup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("loading");

  // On first ever run (no accounts yet), show the admin setup form instead.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/bootstrap");
        const { needsSetup } = await res.json();
        if (alive) setMode(needsSetup ? "setup" : "login");
      } catch {
        if (alive) setMode("login");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <AuthCard>
      {mode === "loading" && (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
          <Spinner /> Loading…
        </p>
      )}
      {mode === "setup" && <SetupForm />}
      {mode === "login" && <LoginForm />}
    </AuthCard>
  );
}

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? "Login failed";
        setError(message);
        notify("error", message);
        setBusy(false);
        return;
      }
      notify("success", "Signed in successfully.");
      const { user } = (await res.json()) as { user: { role: Role } };
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("next") || homeForRole(user.role);
    } catch {
      setError("Network error");
      notify("error", "Network error. Please try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
        Sign in
      </h1>
      <p className="mb-5 text-sm text-zinc-500">
        Enter the username and password your administrator gave you.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Username">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <a
          href="/forgot-password"
          className="-mt-2 self-end text-xs font-medium text-teal-700 hover:underline"
        >
          Forgot password?
        </a>
        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </>
  );
}

function SetupForm() {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? "Setup failed";
        setError(message);
        notify("error", message);
        setBusy(false);
        return;
      }
      notify("success", "Admin account created.");
      window.location.href = "/"; // admin lands on the dashboard
    } catch {
      setError("Network error");
      notify("error", "Network error. Please try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
        Welcome — create your admin
      </h1>
      <p className="mb-5 text-sm text-zinc-500">
        This is the first time the system is opened. Create the administrator
        account. You&apos;ll use it to add the rest of your staff.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Your full name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field label="Choose a username">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. admin"
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Choose a password">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          {busy ? "Creating…" : "Create admin & continue"}
        </Button>
      </form>
    </>
  );
}
