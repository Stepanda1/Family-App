CREATE TYPE family_role AS ENUM ('PARENT', 'CHILD');
CREATE TYPE executor_kind AS ENUM ('FAMILY_MEMBER', 'EXTERNAL_HELPER');
CREATE TYPE planner_item_type AS ENUM ('TASK', 'EVENT', 'SHOPPING');
CREATE TYPE planner_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE planner_status AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE execution_status AS ENUM ('SUCCESS', 'LATE', 'SKIPPED');

CREATE TABLE families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Yekaterinburg',
    invite_code VARCHAR(12) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    display_name VARCHAR(80) NOT NULL,
    role family_role NOT NULL,
    color VARCHAR(7) NOT NULL,
    phone VARCHAR(20),
    birth_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (family_id, display_name)
);

CREATE TABLE executors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    participant_id UUID UNIQUE REFERENCES participants(id) ON DELETE SET NULL,
    display_name VARCHAR(80) NOT NULL,
    kind executor_kind NOT NULL,
    contact_info VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    item_type planner_item_type NOT NULL,
    color VARCHAR(7) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (family_id, item_type, name)
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    creator_participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    title VARCHAR(140) NOT NULL,
    description TEXT,
    item_type planner_item_type NOT NULL,
    priority planner_priority NOT NULL DEFAULT 'MEDIUM',
    status planner_status NOT NULL DEFAULT 'NEW',
    list_name VARCHAR(80),
    location VARCHAR(140),
    scheduled_start_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    reminder_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assignments (
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    executor_id UUID NOT NULL REFERENCES executors(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    start_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    reminder_offset_minutes INTEGER,
    PRIMARY KEY (task_id, executor_id)
);

CREATE TABLE task_executions (
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actual_duration_minutes INTEGER,
    status execution_status NOT NULL,
    note TEXT,
    PRIMARY KEY (participant_id, task_id, executed_at)
);

CREATE INDEX idx_participants_family_id ON participants(family_id);
CREATE INDEX idx_executors_family_id ON executors(family_id);
CREATE INDEX idx_categories_family_type ON categories(family_id, item_type);
CREATE INDEX idx_tasks_family_calendar ON tasks(family_id, item_type, scheduled_start_at);
CREATE INDEX idx_tasks_family_status_due ON tasks(family_id, status, due_at);
CREATE INDEX idx_assignments_executor_id ON assignments(executor_id);
CREATE INDEX idx_task_executions_task_id ON task_executions(task_id, executed_at);
