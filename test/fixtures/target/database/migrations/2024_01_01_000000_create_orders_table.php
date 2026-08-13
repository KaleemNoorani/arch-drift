<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('fulfillment_orders', function (Blueprint $table) {
            $table->id();
            $table->string('upstream_order_id');
            $table->timestamps();
        });
    }

    public function down()
    {
    }
};
