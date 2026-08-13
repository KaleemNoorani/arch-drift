<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::table('fulfillment_orders', function (Blueprint $table) {
            $table->index('upstream_order_id');
        });
    }

    public function down()
    {
        Schema::table('fulfillment_orders', function (Blueprint $table) {
            $table->dropIndex(['upstream_order_id']);
        });
    }
};
