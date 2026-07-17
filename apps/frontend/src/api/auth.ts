import { LoginRequestSchema, LoginResponseSchema, type LoginRequest } from "@brewhub/shared-types";
import { apiFetch, setToken } from "./client";

export async function login(credentials: LoginRequest): Promise<void> {
  const body = LoginRequestSchema.parse(credentials);
  const response = await apiFetch<unknown>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const { token } = LoginResponseSchema.parse(response);
  setToken(token);
}
