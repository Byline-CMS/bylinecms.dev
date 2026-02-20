/**
 * EarlyThemeDetector is a theme detector shim script that runs early on the client
 * to detect the user's preferred color scheme and apply it to the document.
 * It will execute as a blocking script in the head section of the html document.
 * Since it modifies the html element, the html element must have the
 * suppressHydrationWarning attribute set.
 */

export function EarlyThemeDetector({ nonce, force }: { nonce?: string; force?: 'light' | 'dark' }) {
  return (
    <script
      id="theme-detection"
      nonce={nonce ?? undefined}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: required
      dangerouslySetInnerHTML={{
        __html: `
              (() => {
                const classList = document.documentElement.classList
                const style = document.documentElement.style
                const system = window.matchMedia('(prefers-color-scheme: dark)')
                const force = "${force}";
                let theme = localStorage.theme
                if  (theme != null && theme !== 'dark' && theme !== 'light') {
                  localStorage.removeItem("theme"); // Clean up invalid value
                  theme = null;
                }
                
                if (theme == null) {
                  if (force == null || force === 'undefined' || force.length === 0) {
                    if (system.matches) {
                      classList.remove("light");  
                      classList.add("dark");
                      style.colorScheme = "dark";
                    } else {
                      classList.remove("dark");
                      classList.add("light");
                      style.colorScheme = "light";
                    }
                  } else {
                    localStorage.setItem("theme", force);
                    classList.remove("light");
                    classList.remove("dark");
                    classList.add(force);
                    style.colorScheme = force;
                  }
                } else {
                  if (theme === "dark") {
                    classList.remove("light");
                    classList.add("dark");
                    style.colorScheme = "dark";
                  } else if (theme === "light") {
                    classList.remove("dark");
                    classList.add("light");
                    style.colorScheme = "light";
                  }
                }
              })();
            `,
      }}
    />
  )
}
