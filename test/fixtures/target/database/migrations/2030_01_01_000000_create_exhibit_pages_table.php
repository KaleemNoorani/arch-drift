<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('exhibit_pages', function (Blueprint $table) {
            $table->id();
            $table->string('exhibit_uuid');
            $table->string('display_slug');
            $table->timestamps();
        });
    }

    public function down()
    {
    }
};
