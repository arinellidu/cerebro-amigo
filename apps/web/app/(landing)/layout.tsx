/**
 * Landing layout — aplica theme-noir no wrapper externo ao {children}.
 *
 * Este layout persiste durante SPA navigation entre páginas do grupo (landing),
 * garantindo que o tema dark espacial esteja sempre ativo. Sem ele, Next.js App
 * Router recria o elemento raiz a cada navegação e o background-color do
 * theme-noir não é aplicado a tempo pelo browser (FOUC / bg branco).
 */
export default function LandingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="theme-noir min-h-screen" style={{ backgroundColor: '#07070D' }}>
      {children}
    </div>
  )
}
