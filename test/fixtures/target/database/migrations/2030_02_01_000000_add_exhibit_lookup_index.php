<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::table('exhibit_pages', function (Blueprint $table) {
            $table->index('exhibit_uuid');
        });
    }

    public function down()
    {
        Schema::table('exhibit_pages', function (Blueprint $table) {
            $table->dropIndex(['exhibit_uuid']);
        });
    }
};
