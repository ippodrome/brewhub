import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { ApiError } from "../api/client";

export function Login(): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ username, password });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? "Invalid username or password" : "Could not reach server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-8"
      >
        <h1 className="text-xl font-semibold text-neutral-100">BrewHub</h1>
        <div className="space-y-1">
          <label className="text-sm text-neutral-400">Username</label>
          <input
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-neutral-400">Password</label>
          <input
            type="password"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-neutral-100 px-3 py-2 font-medium text-neutral-900 disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
