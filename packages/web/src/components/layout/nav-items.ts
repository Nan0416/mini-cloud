import { Activity, Cloud, ListTree, Radio, Server, Variable } from 'lucide-react';
import { urls } from '@/lib/urls';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: typeof Cloud;
  /** Match nested routes too, so a task detail keeps "Tasks" highlighted. */
  readonly matchPrefix?: string;
}

export interface NavSection {
  readonly title: string;
  readonly items: ReadonlyArray<NavItem>;
}

export const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  {
    title: 'Operations',
    items: [
      { to: urls.overview(), label: 'Overview', icon: Cloud },
      { to: urls.tasks(), label: 'Tasks', icon: ListTree, matchPrefix: '/tasks' },
      { to: urls.instances(), label: 'Instances', icon: Activity, matchPrefix: '/instances' },
    ],
  },
  {
    title: 'Fleet',
    items: [
      { to: urls.agents(), label: 'Agents', icon: Server },
      { to: urls.variables(), label: 'Variables', icon: Variable },
      { to: urls.pubsub(), label: 'Pub/Sub', icon: Radio },
    ],
  },
];
