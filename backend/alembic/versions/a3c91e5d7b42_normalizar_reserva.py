"""normalizar reserva: camping, fechas, monto, titular y estado operativo

Revision ID: a3c91e5d7b42
Revises: 7224388d1b53
Create Date: 2026-10-05 18:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a3c91e5d7b42'
down_revision: Union[str, Sequence[str], None] = '7224388d1b53'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Los mismos valores que usa la app (core/config.py), leídos del entorno.
# Se leen acá y no se importa la app para que la migración no dependa del código.
CAMPING_ID = os.getenv("CAMPING_ID", "CAMP-MENDOZA-01")
CAPACIDAD_TOTAL = int(os.getenv("CAMPING_TOTAL_CAPACITY", "50"))
BUFFER_OFFLINE = int(os.getenv("CAMPING_OFFLINE_BUFFER", "5"))
PRECIO_BASE = float(os.getenv("PRECIO_BASE_POR_PERSONA", "5000.0"))
DESCUENTO_SOCIO = float(os.getenv("PORCENTAJE_DESCUENTO_SOCIO", "0.20"))

# create_type=False porque el tipo se crea a mano en upgrade(), antes de agregar la columna
estado_reserva_enum = postgresql.ENUM(
    'PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'FINALIZADA', name='estadoreservaenum', create_type=False
)


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    # 1. Las reservas van a referenciar al camping, así que tiene que existir su configuración.
    # Si ya está cargada no se toca.
    op.execute(
        sa.text(
            "INSERT INTO configuracion_camping "
            "(id, camping_id, capacidad_total, porcentaje_buffer_offline, precio_base_actual) "
            "SELECT gen_random_uuid(), :camping_id, :capacidad, :buffer, :precio "
            "WHERE NOT EXISTS (SELECT 1 FROM configuracion_camping WHERE camping_id = :camping_id)"
        ).bindparams(
            camping_id=CAMPING_ID,
            capacidad=CAPACIDAD_TOTAL,
            buffer=round(BUFFER_OFFLINE * 100 / CAPACIDAD_TOTAL),
            precio=PRECIO_BASE,
        )
    )

    # 2. Columnas nuevas: primero nullable, para poder completarlas en las filas existentes
    estado_reserva_enum.create(bind, checkfirst=True)
    op.add_column('reservas', sa.Column('camping_id', sa.String(), nullable=True))
    op.add_column('reservas', sa.Column('fecha_ingreso', sa.Date(), nullable=True))
    op.add_column('reservas', sa.Column('fecha_egreso', sa.Date(), nullable=True))
    op.add_column('reservas', sa.Column('monto_total', sa.Float(), nullable=True))
    op.add_column('reservas', sa.Column('titular', sa.String(), nullable=True))
    op.add_column('reservas', sa.Column('email', sa.String(), nullable=True))
    op.add_column('reservas', sa.Column('telefono', sa.String(), nullable=True))
    op.add_column('reservas', sa.Column('estado_reserva', estado_reserva_enum, nullable=True))

    # 3. Completamos las reservas que ya existen sin perder nada de lo que tenían:
    # - hasta ahora fecha_reserva se usaba como fecha de llegada, así que de ahí salen
    #   ingreso y egreso (misma fecha) y fecha_reserva queda como estaba
    # - titular y email se copian del usuario dueño de la reserva
    # - el monto se calcula con el precio actual (el precio cobrado en su momento no se guardaba)
    # - el estado operativo sale del estado de pago que tenían
    op.execute(
        sa.text(
            "UPDATE reservas AS r SET "
            "camping_id = :camping_id, "
            "fecha_ingreso = r.fecha_reserva::date, "
            "fecha_egreso = r.fecha_reserva::date, "
            "titular = u.nombre, "
            "email = u.email, "
            "monto_total = r.cantidad_personas * :precio "
            "  * (CASE WHEN COALESCE(u.is_socio, false) THEN 1 - :descuento ELSE 1 END), "
            "estado_reserva = (CASE r.estado_pago "
            "  WHEN 'PAGADO' THEN 'CONFIRMADA' "
            "  WHEN 'CANCELADO' THEN 'CANCELADA' "
            "  ELSE 'PENDIENTE' END)::estadoreservaenum "
            "FROM usuarios AS u WHERE u.id = r.user_id"
        ).bindparams(camping_id=CAMPING_ID, precio=PRECIO_BASE, descuento=DESCUENTO_SOCIO)
    )

    # 4. Ya completas, las columnas obligatorias pasan a NOT NULL (telefono queda nullable)
    for columna in ('camping_id', 'fecha_ingreso', 'fecha_egreso', 'monto_total',
                    'titular', 'email', 'estado_reserva'):
        op.alter_column('reservas', columna, nullable=False)

    op.create_foreign_key(
        'fk_reservas_camping_id', 'reservas', 'configuracion_camping', ['camping_id'], ['camping_id']
    )
    op.create_check_constraint(
        'ck_reservas_egreso_desde_ingreso', 'reservas', 'fecha_egreso >= fecha_ingreso'
    )
    op.create_index(op.f('ix_reservas_fecha_ingreso'), 'reservas', ['fecha_ingreso'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_reservas_fecha_ingreso'), table_name='reservas')
    op.drop_constraint('ck_reservas_egreso_desde_ingreso', 'reservas', type_='check')
    op.drop_constraint('fk_reservas_camping_id', 'reservas', type_='foreignkey')
    op.drop_column('reservas', 'estado_reserva')
    op.drop_column('reservas', 'telefono')
    op.drop_column('reservas', 'email')
    op.drop_column('reservas', 'titular')
    op.drop_column('reservas', 'monto_total')
    op.drop_column('reservas', 'fecha_egreso')
    op.drop_column('reservas', 'fecha_ingreso')
    op.drop_column('reservas', 'camping_id')
    estado_reserva_enum.drop(op.get_bind(), checkfirst=True)
