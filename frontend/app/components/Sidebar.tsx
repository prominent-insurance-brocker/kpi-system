'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LayoutDashboard, FileText, Car, Users, TrendingUp, Anchor, HeartPulse } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/context/AuthContext';

interface NavItem {
  name: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: NavItem[];
  adminOnly?: boolean;
  moduleKey?: string;
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    name: 'General',
    icon: FileText,
    children: [
      { name: 'General New', href: '/general/new', moduleKey: 'general_new' },
      { name: 'General Renewal', href: '/general/renewal', moduleKey: 'general_renewal' },
      { name: 'General Claim', href: '/general/claim', moduleKey: 'general_claim' },
    ],
  },
  {
    name: 'Motor',
    icon: Car,
    children: [
      { name: 'Motor New', href: '/motor/new', moduleKey: 'motor_new' },
      { name: 'Motor Renewal', href: '/motor/renewal', moduleKey: 'motor_renewal' },
      { name: 'Motor Claim', href: '/motor/claim', moduleKey: 'motor_claim' },
    ],
  },
  {
    name: 'Sales',
    icon: TrendingUp,
    children: [
      { name: 'Sales KPI', href: '/sales/kpi', moduleKey: 'sales_kpi' },
    ],
  },
  {
    name: 'Marine',
    icon: Anchor,
    children: [
      { name: 'Marine New', href: '/marine/new', moduleKey: 'marine_new' },
      { name: 'Marine Renewal', href: '/marine/renewal', moduleKey: 'marine_renewal' },
    ],
  },
  {
    name: 'Medical',
    icon: HeartPulse,
    children: [
      { name: 'Medical Claim', href: '/medical/claim', moduleKey: 'medical_claim' },
    ],
  },
  {
    name: 'User Management',
    icon: Users,
    adminOnly: true,
    children: [
      { name: 'Users', href: '/admin/users' },
      { name: 'Roles', href: '/admin/roles' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, hasModulePermission } = useAuth();
  const [expandedItems, setExpandedItems] = useState<string[]>(['General', 'Motor', 'Sales', 'Marine', 'Medical', 'User Management']);

  const toggleExpand = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const checkPermission = (item: NavItem): boolean => {
    if (user?.is_staff) return true;
    if (item.adminOnly) return false;
    if (item.moduleKey) {
      return hasModulePermission(item.moduleKey);
    }
    return true;
  };

  const renderNavItem = (item: NavItem) => {
    if (!checkPermission(item)) return null;

    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.name);
    const isActive = item.href && pathname === item.href;
    const Icon = item.icon;

    const visibleChildren = hasChildren
      ? item.children!.filter((child) => checkPermission(child))
      : [];

    if (hasChildren && visibleChildren.length === 0) return null;

    return (
      <div key={item.name} className="flex flex-col gap-1.5">
        {item.href ? (
          <Link
            href={item.href}
            className={cn(
              'flex items-center gap-2 py-2 px-3 rounded-md text-sm font-medium h-9',
              isActive
                ? 'bg-accent text-primary font-semibold'
                : 'text-[#343434] hover:bg-accent'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            <span className="flex-1">{item.name}</span>
          </Link>
        ) : (
          <button
            onClick={() => toggleExpand(item.name)}
            className={cn(
              'flex items-center gap-2 py-2 px-3 rounded-md text-sm font-medium text-[#343434] hover:bg-accent h-9 w-full'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            <span className="flex-1 text-left">{item.name}</span>
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                !isExpanded && '-rotate-90'
              )}
              strokeWidth={1.5}
            />
          </button>
        )}
        {hasChildren && isExpanded && (
          <div className="flex pl-5 gap-3">
            {/* Vertical divider line */}
            <div className="w-px bg-[#D4D4D4] self-stretch" />
            {/* Sub-menu items */}
            <div className="flex flex-col gap-1.5 flex-1">
              {visibleChildren.map((child) => {
                const childActive = child.href && pathname === child.href;
                return (
                  <Link
                    key={child.name}
                    href={child.href!}
                    className={cn(
                      'flex items-center gap-2 py-2 px-3 rounded-md text-sm font-medium h-9',
                      childActive
                        ? 'bg-accent text-primary font-semibold'
                        : 'text-[#343434] hover:bg-accent'
                    )}
                  >
                    {child.name}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-[274px] bg-white border-r border-[#E4E4E4] h-screen sticky top-0 flex flex-col pb-12">
      {/* Logo section */}
      <div className="px-6 py-[0.97rem] border-b border-[#E4E4E4] ">
        <h1 className="text-2xl font-bold text-[#141416]">KPI System</h1>
      </div>
      {/* Navigation */}
      <nav className="px-4 py-3 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1.5">
          {navigation.map((item) => renderNavItem(item))}
        </div>
      </nav>
    </aside>
  );
}
