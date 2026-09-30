"""corregir tabla conflictos_sincronizacion: Base y tipos UUID

Revision ID: 7224388d1b53
Revises: f30ae74360fe
Create Date: 2026-09-03 15:35:41.726242

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7224388d1b53'
down_revision: Union[str, Sequence[str], None] = 'f30ae74360fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'conflictos_sincronizacion',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('reserva_id', sa.UUID(), nullable=False),
        sa.Column('jti_involucrado', sa.String(), nullable=False),
        sa.Column('motivo', sa.String(), nullable=False),
        sa.Column('fecha_registro', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_conflictos_sincronizacion_reserva_id'),
        'conflictos_sincronizacion',
        ['reserva_id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        op.f('ix_conflictos_sincronizacion_reserva_id'),
        table_name='conflictos_sincronizacion',
    )
    op.drop_table('conflictos_sincronizacion')