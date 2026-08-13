<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up()
    {
        DB::statement('UPDATE fulfillment_orders SET upstream_order_id = CONCAT(upstream_order_id, \'-merged\') WHERE upstream_order_id IN (SELECT upstream_order_id FROM legacy_warehouse_orders)');
    }

    public function down()
    {
        // @architecturally-irreversible: merges legacy warehouse rows into fulfillment_orders in place;
        // the original per-row source can't be reconstructed once merged.
    }
};
