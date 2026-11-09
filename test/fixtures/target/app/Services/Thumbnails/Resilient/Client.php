<?php

namespace App\Services\Thumbnails\Resilient;

class Client
{
    public function fetchPreview(string $assetId)
    {
        try {
            return $this->provider()->get("/preview/{$assetId}")->json();
        } catch (\Throwable $error) {
            report($error);
            return null;
        }
    }
}
