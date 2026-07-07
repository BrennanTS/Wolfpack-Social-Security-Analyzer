export interface ResourceLink {
  title: string;
  description: string;
  href: string;
}

export interface ResourceSection {
  title: string;
  links: ResourceLink[];
}

export const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    title: 'Social Security Administration',
    links: [
      {
        title: 'SSA.gov — Official site',
        description: 'Benefits, eligibility, and official program information.',
        href: 'https://www.ssa.gov/',
      },
      {
        title: 'mySocialSecurity',
        description: 'Create an account to view your earnings record and benefit estimates.',
        href: 'https://www.ssa.gov/myaccount/',
      },
      {
        title: 'Retirement Planner',
        description: 'Interactive SSA tool for retirement benefit estimates.',
        href: 'https://www.ssa.gov/benefits/retirement/planner/',
      },
      {
        title: 'Quick Calculator',
        description: 'Rough benefit estimate from birth date and earnings.',
        href: 'https://www.ssa.gov/OACT/quickcalc/',
      },
      {
        title: 'Early or Late Retirement?',
        description: 'See how claiming before or after FRA changes your monthly benefit.',
        href: 'https://www.ssa.gov/OACT/quickcalc/early_retire.html',
      },
      {
        title: 'When to Start Receiving Benefits',
        description: 'SSA publication on timing your claim (PDF).',
        href: 'https://www.ssa.gov/pubs/EN-05-10147.pdf',
      },
      {
        title: 'Full Retirement Age by Year',
        description: 'FRA table for people born from 1938 through 1960 and later.',
        href: 'https://www.ssa.gov/oact/ProgData/nra.html',
      },
      {
        title: 'Cost-of-Living Adjustments (COLA)',
        description: 'Historical and current SSA COLA percentages.',
        href: 'https://www.ssa.gov/oact/cola/latestCOLA.html',
      },
      {
        title: 'Period Life Tables',
        description: 'SSA mortality data used for life expectancy planning.',
        href: 'https://www.ssa.gov/oact/STATS/table4c6.html',
      },
    ],
  },
  {
    title: 'ssa.tools (calculation engine)',
    links: [
      {
        title: 'ssa.tools calculator',
        description: 'Open-source Social Security optimizer this app is built on.',
        href: 'https://ssa.tools/',
      },
      {
        title: 'ssa.tools on GitHub',
        description: 'Source code, formulas, and mortality tables (MIT license).',
        href: 'https://github.com/Gregable/social-security-tools',
      },
    ],
  },
  {
    title: 'Planning & research',
    links: [
      {
        title: 'Bureau of Labor Statistics — CPI-U',
        description: 'Official inflation data behind COLA assumptions.',
        href: 'https://www.bls.gov/cpi/',
      },
      {
        title: 'Spousal Benefits',
        description: 'How spousal benefits work when one spouse has lower earnings.',
        href: 'https://www.ssa.gov/benefits/retirement/planner/applying7.html',
      },
      {
        title: 'Survivors Benefits',
        description: 'Benefits for widows, widowers, and dependents.',
        href: 'https://www.ssa.gov/benefits/survivors/',
      },
      {
        title: 'Understanding the Earnings Test',
        description: 'How working before FRA can temporarily reduce benefits.',
        href: 'https://www.ssa.gov/benefits/retirement/planner/whileworking.html',
      },
    ],
  },
];
