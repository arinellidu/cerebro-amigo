"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

export async function logoutAction() {
  const c = await cookies()
  c.delete("auth_token")
  redirect("/login")
}
