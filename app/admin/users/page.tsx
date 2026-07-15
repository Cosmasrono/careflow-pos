"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  inputClass,
} from "@/components/ui";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { notify } from "@/lib/toast";

interface StaffUser {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  active: boolean;
}

const emptyForm = {
  name: "",
  username: "",
  email: "",
  role: "receptionist" as Role,
  password: "",
};

type UsersApiResponse = {
  users: StaffUser[];
  warning?: string;
};

export default function UsersPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/users");
      if (alive && res.ok) setUsers((await res.json()).users);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const message = body.error ?? "Could not create user";
      setError(message);
      notify("error", message);
      return;
    }
    const body = (await res.json()) as UsersApiResponse;
    setUsers(body.users);
    setForm(emptyForm);
    notify("success", "Staff account created.");
    if (body.warning) {
      notify("error", body.warning);
    } else if (form.email.trim()) {
      notify("success", "Password setup link sent by email.");
    }
  };

  const patch = async (id: string, changes: Partial<StaffUser>) => {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      notify("error", body.error ?? "Could not update user.");
      return;
    }
    setUsers((await res.json()).users);
    notify("success", "Staff account updated.");
  };

  const resetPassword = async (id: string) => {
    const pw = prompt("New password for this user:");
    if (pw) patch(id, { password: pw } as Partial<StaffUser>);
  };

  const editEmail = async (u: StaffUser) => {
    const email = prompt(
      "Email for password-reset links (leave empty to remove):",
      u.email ?? "",
    );
    if (email !== null) patch(u.id, { email });
  };

  const removeUser = async (u: StaffUser) => {
    const proceed = confirm(`Delete ${u.name}? This cannot be undone.`);
    if (!proceed) return;

    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      notify("error", body.error ?? "Could not delete user.");
      return;
    }
    setUsers((await res.json()).users);
    notify("success", "User deleted.");
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Create staff accounts and assign roles. Only admins see this page."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Roster */}
        <div>
          {loading ? (
            <EmptyState>
              <span className="inline-flex items-center gap-2">
                <Spinner /> Loading…
              </span>
            </EmptyState>
          ) : users.length === 0 ? (
            <EmptyState>No users yet.</EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Username</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-zinc-100">
                      <td className="px-4 py-2 font-medium">{u.name}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {u.username}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => editEmail(u)}
                          className="text-left text-xs text-teal-700 hover:underline"
                          title="Edit email"
                        >
                          {u.email ?? <span className="text-zinc-400">Set email</span>}
                        </button>
                      </td>
                      <td className="px-4 py-2">
                        <select
                          className={`${inputClass} h-8`}
                          value={u.role}
                          onChange={(e) =>
                            patch(u.id, { role: e.target.value as Role })
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            u.active
                              ? "text-green-700"
                              : "text-zinc-400 line-through"
                          }
                        >
                          {u.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resetPassword(u.id)}
                          >
                            Reset pw
                          </Button>
                          <Button
                            size="sm"
                            variant={u.active ? "ghost" : "secondary"}
                            onClick={() => patch(u.id, { active: !u.active })}
                          >
                            {u.active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeUser(u)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>

        {/* Create */}
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-zinc-700">
            Add staff member
          </h2>
          <form onSubmit={create} className="flex flex-col gap-4">
            <Field label="Full name">
              <input
                className={inputClass}
                value={form.name}
                onChange={set("name")}
                required
              />
            </Field>
            <Field label="Username">
              <input
                className={inputClass}
                value={form.username}
                onChange={set("username")}
                placeholder="e.g. reception1"
                required
              />
            </Field>
            <Field label="Email (for password resets)">
              <input
                className={inputClass}
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="recommended"
              />
            </Field>
            <Field label="Role">
              <select
                className={inputClass}
                value={form.role}
                onChange={set("role")}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Temporary password (optional)">
              <input
                className={inputClass}
                type="password"
                value={form.password}
                onChange={set("password")}
                placeholder="Leave empty to require setup by email"
              />
            </Field>
            {error && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit">Create account</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
