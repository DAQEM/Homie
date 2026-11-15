CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed a starter Home Screen on a fresh database so cold boot never hits an empty workspace dead-end
DO $$
DECLARE
    ws_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM workspaces) THEN
        ws_id := gen_random_uuid();

        INSERT INTO workspaces (id, name)
        VALUES (ws_id, 'Home');

        -- Starter Clock (2x2)
        INSERT INTO nodes (workspace_id, sort_order, grid_x, grid_y, title, node_type, width, height, settings)
        VALUES (
            ws_id, 101, 1, 1, 'Amsterdam', 'clock', 2, 2,
            '{"timezone":"Europe/Amsterdam","flag":"🇳🇱","sweepSeconds":true}'::jsonb
        );

        -- Starter Weather (2x2)
        INSERT INTO nodes (workspace_id, sort_order, grid_x, grid_y, title, node_type, width, height, settings)
        VALUES (
            ws_id, 301, 1, 3, 'Amsterdam', 'weather', 2, 2,
            '{"location":"Amsterdam","tempUnit":"C"}'::jsonb
        );

        -- Starter Search Bar (6x1)
        INSERT INTO nodes (workspace_id, sort_order, grid_x, grid_y, title, node_type, width, height, settings)
        VALUES (
            ws_id, 103, 3, 1, 'Search', 'search', 6, 1,
            '{"placeholder":"Search Web or Spotlight (⌘K)...","engineUrl":"https://www.google.com/search?q="}'::jsonb
        );

        -- Starter Calendar (4x2)
        INSERT INTO nodes (workspace_id, sort_order, grid_x, grid_y, title, node_type, width, height, settings)
        VALUES (
            ws_id, 203, 3, 2, 'Schedule', 'calendar', 4, 2,
            '{"timezone":"Europe/Amsterdam","calendarFeeds":[]}'::jsonb
        );

        -- Starter Vikunja Tasks (4x2)
        INSERT INTO nodes (workspace_id, sort_order, grid_x, grid_y, title, node_type, width, height, settings)
        VALUES (
            ws_id, 207, 7, 2, 'Tasks', 'todo', 4, 2,
            '{"vikunjaFilter":"all","vikunjaShowCompleted":false}'::jsonb
        );

        -- Starter Docked Shortcuts
        INSERT INTO nodes (workspace_id, sort_order, grid_x, grid_y, title, node_type, url, width, height, settings)
        VALUES
            (ws_id, 1, -1, -1, 'GitHub', 'action', 'https://github.com', 1, 1, '{"healthCheck":false}'::jsonb),
            (ws_id, 2, -1, -1, 'Hacker News', 'action', 'https://news.ycombinator.com', 1, 1, '{"healthCheck":false}'::jsonb);
    END IF;
END $$;
