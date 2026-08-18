import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { THEMES, useTheme, type Theme } from '@/hooks/use-theme';

const LABELS: Readonly<Record<Theme, string>> = { light: 'Light', dark: 'Dark', system: 'System' };
const ICONS: Readonly<Record<Theme, typeof Sun>> = { light: Sun, dark: Moon, system: Monitor };

export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  // The trigger shows what you are looking at, not what you selected: under
  // `system` an icon reading "system" tells you nothing about the current appearance.
  const Icon = resolved === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${LABELS[theme]}`}>
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(THEMES.find((candidate) => candidate === value) ?? 'system')}>
          {THEMES.map((candidate) => {
            const CandidateIcon = ICONS[candidate];
            return (
              <DropdownMenuRadioItem key={candidate} value={candidate}>
                <CandidateIcon className="size-4" />
                {LABELS[candidate]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
