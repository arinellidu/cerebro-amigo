import { Suspense } from "react"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { Toaster } from "@/components/ui/sonner"
import { CommandPalette } from "@/components/admin/command-palette"
import { AdminStatusProvider } from "@/components/admin/admin-status"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminStatusProvider>
      <div className="theme-noir min-h-screen bg-background text-foreground">
        {/* Cache Components (Next 16): sidebar lê usePathname e as páginas
            dinâmicas leem useParams — dados de request. Cada um precisa de um
            limite de Suspense para o prerender gerar o shell estático. */}
        <Suspense>
          <AdminSidebar />
        </Suspense>
        <main className="pl-60 min-h-screen">
          <div className="relative">
            <Suspense>{children}</Suspense>
          </div>
        </main>
        <Toaster />
        <CommandPalette />
      </div>
    </AdminStatusProvider>
  )
}
