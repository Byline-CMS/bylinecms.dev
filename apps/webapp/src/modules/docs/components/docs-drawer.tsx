'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Docs navigation drawer. `docs` is a `tree: true` collection, so the nav is
 * the document tree (docs/04-collections/04-document-trees.md): parents are collapsible with an
 * animated caret, children are indented and expand/collapse with a smooth
 * height transition. Links are **direct hierarchical URLs** (each node's full
 * `chain`), so no canonical 301 hop. The branch containing the active document
 * is expanded on load — computed from the route's `_splat`, so it is correct in
 * SSR and works without JS.
 *
 * On desktop the drawer is either fully open (pushing content) or fully closed;
 * on mobile it is an overlay. There is no intermediate icon-only state.
 */

import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'

import { ChevronRightIcon } from '@byline/ui/react'
import cx from 'classnames'
import { useSwipeable } from 'react-swipeable'

import { lngParam } from '@/i18n/hooks/use-locale-navigation'
import styles from './docs-drawer.module.css'
import { useDocsMenu } from './docs-provider.js'
import { DocsSearchTrigger } from './docs-search-trigger.js'
import type { Locale } from '@/i18n/i18n-config'
import type { DocNavNode } from '@/modules/docs/nav'

/** Normalize a splat to a comparable `a/b/c` chain key (no leading/trailing /). */
function chainKey(splat: string): string {
  return splat.replace(/^\/+|\/+$/g, '')
}

/** The ids of every parent node on the path to the active document (to expand). */
function activeAncestorIds(nodes: DocNavNode[], activeKey: string): Set<string> {
  const open = new Set<string>()
  const walk = (node: DocNavNode): void => {
    const key = node.chain.join('/')
    const onPath = activeKey === key || activeKey.startsWith(`${key}/`)
    if (onPath && node.children.length > 0) open.add(node.id)
    for (const child of node.children) walk(child)
  }
  for (const node of nodes) walk(node)
  return open
}

interface NavItemProps {
  node: DocNavNode
  depth: number
  activeKey: string
  expanded: Set<string>
  onToggle: (id: string) => void
  lng: Locale
  onNavigate: () => void
}

function NavItem({ node, depth, activeKey, expanded, onToggle, lng, onNavigate }: NavItemProps) {
  const key = node.chain.join('/')
  const hasChildren = node.children.length > 0
  const isActive = activeKey === key
  const isOpen = expanded.has(node.id)

  return (
    <li
      className={cx('menu-item', { active: isActive, 'has-children': hasChildren, open: isOpen })}
    >
      <div className="row" style={{ paddingLeft: `${depth * 14 + 5}px` }}>
        <Link
          className="link"
          to="/$lng/docs/$"
          params={{ ...lngParam(lng), _splat: key }}
          onClick={onNavigate}
        >
          <span className="label">{node.title}</span>
        </Link>
        {hasChildren && (
          <button
            type="button"
            className="caret"
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
            onClick={() => onToggle(node.id)}
          >
            <span className="caret-icon">
              <ChevronRightIcon width="16px" height="16px" />
            </span>
          </button>
        )}
      </div>

      {hasChildren && (
        <div className={cx('subtree', { open: isOpen })}>
          <ul className="subtree-inner">
            {node.children.map((child) => (
              <NavItem
                key={child.id}
                node={child}
                depth={depth + 1}
                activeKey={activeKey}
                expanded={expanded}
                onToggle={onToggle}
                lng={lng}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

interface DocsDrawerProps {
  nodes: DocNavNode[]
  lng: Locale
}

export function DocsDrawer({ nodes, lng }: DocsDrawerProps): React.JSX.Element | null {
  const { mobile, drawerOpen, closeDrawer } = useDocsMenu()
  const params = useParams({ strict: false }) as { _splat?: string }
  const activeKey = chainKey(params._splat ?? '')

  // Expand the active document's branch on load and whenever navigation changes
  // it — without collapsing branches the user has opened manually.
  const [expanded, setExpanded] = useState<Set<string>>(() => activeAncestorIds(nodes, activeKey))
  useEffect(() => {
    const ancestors = activeAncestorIds(nodes, activeKey)
    if (ancestors.size === 0) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of ancestors) next.add(id)
      return next
    })
  }, [nodes, activeKey])

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handlers = useSwipeable({
    onSwipedLeft: () => {
      closeDrawer()
    },
  })

  return (
    <aside
      id="docs-menu"
      className={cx('byline-docs-drawer-aside', styles.aside, {
        'byline-docs-drawer-aside-mobile': mobile === true,
        [styles.asideMobile]: mobile === true,
        'byline-docs-drawer-aside-mobile-open': mobile === true && drawerOpen === true,
        [styles.asideMobileOpen]: mobile === true && drawerOpen === true,
        'byline-docs-drawer-aside-mobile-closed': mobile === true && drawerOpen === false,
        [styles.asideMobileClosed]: mobile === true && drawerOpen === false,
        'byline-docs-drawer-aside-desktop': mobile === false,
        [styles.asideDesktop]: mobile === false,
        'byline-docs-drawer-aside-desktop-open': mobile === false && drawerOpen === true,
        [styles.asideDesktopOpen]: mobile === false && drawerOpen === true,
        'byline-docs-drawer-aside-desktop-closed': mobile === false && drawerOpen === false,
        [styles.asideDesktopClosed]: mobile === false && drawerOpen === false,
      })}
      {...handlers}
    >
      <div className={cx('byline-docs-drawer-header', styles.header)}>
        <DocsSearchTrigger lng={lng} onNavigate={closeDrawer} />
      </div>
      <nav className={cx('byline-docs-drawer docs-drawer', styles.nav)}>
        <ul>
          {nodes.map((node) => (
            <NavItem
              key={node.id}
              node={node}
              depth={0}
              activeKey={activeKey}
              expanded={expanded}
              onToggle={toggle}
              lng={lng}
              onNavigate={closeDrawer}
            />
          ))}
        </ul>
      </nav>
    </aside>
  )
}
