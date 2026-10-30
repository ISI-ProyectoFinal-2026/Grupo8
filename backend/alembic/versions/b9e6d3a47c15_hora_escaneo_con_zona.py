"""fechas de ingreso y de conflicto pasan a timestamptz (se guardan en UTC)

Revision ID: b9e6d3a47c15
Revises: a8c4e1f92b37
"""
from alembic import op
import sqlalchemy as sa

revision = "b9e6d3a47c15"
down_revision = "a8c4e1f92b37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Los valores que ya estaban guardados no tienen zona: se leen como UTC
    op.alter_column(
        "ingresos_fisicos", "fecha_hora_ingreso",
        existing_type=sa.DateTime(),
        type_=sa.DateTime(timezone=True),
        existing_nullable=False,
        postgresql_using="fecha_hora_ingreso AT TIME ZONE 'UTC'",
    )
    op.alter_column(
        "conflictos_sincronizacion", "fecha_registro",
        existing_type=sa.DateTime(),
        type_=sa.DateTime(timezone=True),
        existing_nullable=True,
        postgresql_using="fecha_registro AT TIME ZONE 'UTC'",
    )


def downgrade() -> None:
    op.alter_column(
        "conflictos_sincronizacion", "fecha_registro",
        existing_type=sa.DateTime(timezone=True),
        type_=sa.DateTime(),
        existing_nullable=True,
        postgresql_using="fecha_registro AT TIME ZONE 'UTC'",
    )
    op.alter_column(
        "ingresos_fisicos", "fecha_hora_ingreso",
        existing_type=sa.DateTime(timezone=True),
        type_=sa.DateTime(),
        existing_nullable=False,
        postgresql_using="fecha_hora_ingreso AT TIME ZONE 'UTC'",
    )