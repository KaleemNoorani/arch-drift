<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up()
    {
        DB::statement('UPDATE exhibit_pages SET display_slug = LOWER(display_slug)');
    }

    public function down()
    {
        // @architecturally-irreversible: original letter case is not stored.
    }
};
